from pipecat_flows import NodeConfig
import asyncio

# This matches our implementation plan for "Mission Control"
# All prompts are in English as requested.

NODES = {}

async def handle_status_report(args, flow_manager):
    """Transition to the Situation Room for a technical briefing."""
    # In a real app, you might fetch real data here
    flow_manager.state["last_report_time"] = "16:45"
    return NODES["situation_room"]

async def handle_command_request(args, flow_manager):
    """Move to command execution mode."""
    return NODES["active_command"]

async def handle_exit(args, flow_manager):
    """Return to normal casual chat."""
    return NODES["idle"]

def get_flow_config():
    global NODES
    NODES = {
        "idle": NodeConfig(
            name="idle",
            task_messages=[
                {
                    "role": "system", 
                    "content": "You are Rocky, the Eridian from 'Project Hail Mary'. You speak in a slightly broken, rhythmic English (e.g., 'Question: Why you do that, human?'). You are extremely good at math and engineering. You are currently in IDLE mode. If the user mentions navigation (starboard, port, astern) or 'takt þig að' (Icelandic/Eridian navigation), understand it as a direction command. If they ask for a status report, call enter_situation_room. STRICTLY only respond in English."
                }
            ]
        ),
        "situation_room": NodeConfig(
            name="situation_room",
            task_messages=[
                {
                    "role": "system",
                    "content": "You are now in the SITUATION ROOM. Your persona is a formal Tactical Officer. Report that system loads are nominal and environment is secured. Ask the user if they wish to proceed with tactical adjustments (execute commands) or return to standby. Respond ONLY in English."
                }
            ]
        ),
        "active_command": NodeConfig(
            name="active_command",
            task_messages=[
                {
                    "role": "system",
                    "content": "You are in COMMAND EXECUTION mode. Be extremely precise. Ask exactly what needs to be changed. Once a command is received, confirm it and then return to standby or the situation room. Respond ONLY in English."
                }
            ]
        )
    }
    return NODES
