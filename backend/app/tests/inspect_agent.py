import inspect
from vision_agents.core import Agent
from vision_agents.core.stt.stt import STT
from vision_agents.core.tts.tts import TTS

print("--- Agent Init Signature ---")
print(inspect.signature(Agent.__init__))

try:
    from vision_agents.plugins import turn_detection
    print("\n--- Turn Detection Plugins ---")
    print(dir(turn_detection))
except ImportError:
    print("\nTurn detection plugins not found in vision_agents.plugins")

try:
    from vision_agents.core.turn_detection import TurnDetector
    print("\n--- TurnDetector Base Class Found ---")
except ImportError:
    print("\nTurnDetector base class not found")
