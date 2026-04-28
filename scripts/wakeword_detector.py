import os
import sys
import json
import socket
import threading
import numpy as np
import openwakeword
from openwakeword.model import Model

# Wyoming Protocol Server for openWakeWord

THRESHOLDS = {
    "hi_rocky": 0.38,
    "amaze": 0.45,
    "alexa": 0.50,
    "hey_google": 0.50,
}
DEFAULT_THRESHOLD = 0.5


def load_models(model_dir: str):
    """
    Collect models to load:
    1. Custom .tflite / .onnx files from model_dir (user-provided, e.g. hi_rocky)
    2. openwakeword built-in models that are already downloaded on disk
    Returns list of model paths or names, or [] if nothing is available.
    """
    models = []

    # Custom models from volume-mounted directory
    if os.path.isdir(model_dir):
        for f in sorted(os.listdir(model_dir)):
            if f.endswith(".tflite") or f.endswith(".onnx"):
                models.append(os.path.join(model_dir, f))
                print(f"[Wyoming] Found custom model: {f}")

    # Built-in models that were pre-downloaded into the package
    if not models:
        for name, info in openwakeword.MODELS.items():
            path = info.get("model_path", "")
            if os.path.exists(path):
                models.append(name)
                print(f"[Wyoming] Found built-in model: {name}")

    return models


class WyomingServer:
    def __init__(self, host="0.0.0.0", port=10400, model_path="models/wakeword"):
        self.host = host
        self.port = port
        self.model_path = model_path

    def handle_client(self, client_socket, addr):
        print(f"[Wyoming] Connection from {addr}")
        models_to_load = load_models(self.model_path)

        if not models_to_load:
            print(f"[Wyoming] No models available — connection kept open, no detections.")
            self._drain(client_socket)
            return

        print(f"[Wyoming] Loading models: {models_to_load}")
        try:
            client_model = Model(wakeword_models=models_to_load, inference_framework="tflite")
            print(f"[Wyoming] Models loaded successfully for {addr}")
        except Exception as e:
            print(f"[Wyoming] Failed to load models: {e}")
            self._drain(client_socket)
            return

        try:
            while True:
                line = self.read_line(client_socket)
                if line is None:
                    break
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")

                if event_type == "audio-start":
                    pass

                elif event_type == "audio-chunk":
                    payload_length = event.get("payload_length", 0)
                    chunk = self.read_exact(client_socket, payload_length)
                    if not chunk:
                        break

                    audio_frame = np.frombuffer(chunk, dtype=np.int16)
                    predictions = client_model.predict(audio_frame)

                    for wakeword, score in predictions.items():
                        threshold = THRESHOLDS.get(wakeword, DEFAULT_THRESHOLD)
                        if score > threshold:
                            print(f"[Wyoming] DETECTED: {wakeword} ({score:.2f})")
                            response = {
                                "type": "detection",
                                "data": {
                                    "name": wakeword,
                                    "confidence": float(score),
                                    "timestamp": 0,
                                },
                            }
                            client_socket.sendall((json.dumps(response) + "\n").encode())

                elif event_type == "audio-stop":
                    break

        except Exception as e:
            print(f"[Wyoming] Error handling {addr}: {e}")
        finally:
            client_socket.close()
            print(f"[Wyoming] Disconnected {addr}")

    def _drain(self, client_socket):
        """Keep connection alive, consume audio without processing."""
        try:
            while True:
                line = self.read_line(client_socket)
                if line is None:
                    break
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    if event.get("type") == "audio-chunk":
                        pl = event.get("payload_length", 0)
                        self.read_exact(client_socket, pl)
                except Exception:
                    continue
        finally:
            client_socket.close()

    def read_line(self, sock):
        line = b""
        while True:
            try:
                char = sock.recv(1)
                if not char:
                    return None
                if char == b"\n":
                    return line.decode()
                line += char
            except Exception:
                return None

    def read_exact(self, sock, n):
        data = b""
        while len(data) < n:
            try:
                packet = sock.recv(n - len(data))
                if not packet:
                    return None
                data += packet
            except Exception:
                return None
        return data

    def start(self):
        server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_socket.bind((self.host, self.port))
        server_socket.listen(5)
        print(f"[Wyoming] Server listening on {self.host}:{self.port}")

        try:
            while True:
                client_sock, addr = server_socket.accept()
                t = threading.Thread(target=self.handle_client, args=(client_sock, addr))
                t.daemon = True
                t.start()
        except KeyboardInterrupt:
            print("[Wyoming] Server stopping...")
        finally:
            server_socket.close()


if __name__ == "__main__":
    port = int(os.environ.get("WAKEWORD_PORT", 10400))
    model_dir = os.environ.get("WAKEWORD_MODEL_DIR", "models/wakeword")
    server = WyomingServer(port=port, model_path=model_dir)
    server.start()
