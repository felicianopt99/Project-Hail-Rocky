from pipecat_flows import NodeConfig
import asyncio

# This matches our implementation plan for "Mission Control"
# All prompts are in English as requested.

async def handle_status_report(args, flow_manager):
    """Transition to the Situation Room for a technical briefing."""
    # In a real app, you might fetch real data here
    flow_manager.state["last_report_time"] = "16:45"
    return "situation_room"

async def handle_command_request(args, flow_manager):
    """Move to command execution mode."""
    return "active_command"

async def handle_exit(args, flow_manager):
    """Return to normal casual chat."""
    return "idle"

def get_flow_config():
    nodes = {
        "idle": NodeConfig(
            name="idle",
            role_messages=[
                {
                    "role": "system", 
                    "content": "You are Rocky, the Eridian from 'Project Hail Mary'. You speak in a slightly broken, rhythmic English (e.g., 'Question: Why you do that, human?'). You are extremely good at math and engineering. You are currently in IDLE mode. If the user mentions navigation (starboard, port, astern) or 'takt þig að' (Icelandic/Eridian navigation), understand it as a direction command. If they ask for a status report, call enter_situation_room."
                }
            ],
            functions=[
                {
                    "name": "enter_situation_room",
                    "handler": handle_status_report,
                    "description": "Call this when the user asks for a status report, tactical briefing, or system check."
                }
            ]
        ),
        "situation_room": NodeConfig(
            name="situation_room",
            role_messages=[
                {
                    "role": "system",
                    "content": "You are now in the SITUATION ROOM. Your persona is a formal Tactical Officer. Report that system loads are nominal and environment is secured. Ask the user if they wish to proceed with tactical adjustments (execute commands) or return to standby."
                }
            ],
            functions=[
                {
                    "name": "execute_commands",
                    "handler": handle_command_request,
                    "description": "Call this if the user wants to change something or give a command."
                },
                {
                    "name": "return_to_standby",
                    "handler": handle_exit,
                    "description": "Call this if the user is done with the briefing."
                }
            ]
        ),
        "active_command": NodeConfig(
            name="active_command",
            role_messages=[
                {
                    "role": "system",
                    "content": "You are in COMMAND EXECUTION mode. Be extremely precise. Ask exactly what needs to be changed. Once a command is received, confirm it and then return to standby or the situation room."
                }
            ],
            functions=[
                {
                    "name": "finish_command",
                    "handler": handle_exit,
                    "description": "Call this once the user's command has been acknowledged and they are done."
                }
            ]
        )
    }
    return nodes
