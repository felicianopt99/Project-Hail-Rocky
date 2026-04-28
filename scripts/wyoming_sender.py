import socket
import json
import sys
import time

def send_wyoming(host, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect((host, port))
        print(f"Connected to {host}:{port}")

        # Send audio-start
        start_event = {
            "type": "audio-start",
            "data": {"rate": 16000, "width": 2, "channels": 1}
        }
        s.sendall(json.dumps(start_event).encode() + b"\n")

        print("Recording and sending... Press Ctrl+C to stop.")
        
        # Read from stdin (piped from arecord)
        chunk_size = 1024
        while True:
            chunk = sys.stdin.buffer.read(chunk_size)
            if not chunk:
                break
            
            # Wrap in audio-chunk
            chunk_event = {
                "type": "audio-chunk",
                "data": {"rate": 16000, "width": 2, "channels": 1},
                "payload_length": len(chunk)
            }
            s.sendall(json.dumps(chunk_event).encode() + b"\n")
            s.sendall(chunk)
            
            # Check for responses (detection)
            s.setblocking(False)
            try:
                resp = s.recv(4096)
                if resp:
                    print(f"\n[Wyoming Response] {resp.decode().strip()}")
            except BlockingIOError:
                pass
            s.setblocking(True)

    except KeyboardInterrupt:
        print("\nStopping...")
    except Exception as e:
        print(f"\nError: {e}")
    finally:
        # Send audio-stop
        try:
            stop_event = {"type": "audio-stop", "data": {}}
            s.sendall(json.dumps(stop_event).encode() + b"\n")
        except: pass
        s.close()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python wyoming_sender.py <host> <port>")
        sys.exit(1)
    
    send_wyoming(sys.argv[1], int(sys.argv[2]))
