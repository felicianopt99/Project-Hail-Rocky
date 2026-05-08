from langgraph.graph import StateGraph, END
from .state import RockyState
from .nodes import (
    retrieve_memory, 
    inject_personality, 
    llm_reasoning, 
    execute_tools, 
    update_memory
)

def should_continue(state: RockyState):
    """
    Conditional logic: Check if the LLM called any tools.
    """
    messages = state["messages"]
    last_message = messages[-1]
    
    # If the last message has tool calls, we must execute them
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    
    # Otherwise, update memory and finish
    return "update_mem"

# Define the graph
workflow = StateGraph(RockyState)

# Add nodes
workflow.add_node("memory", retrieve_memory)
workflow.add_node("personality", inject_personality)
workflow.add_node("llm", llm_reasoning)
workflow.add_node("tools", execute_tools)
workflow.add_node("update_mem", update_memory)

# Connect edges
workflow.set_entry_point("memory")

workflow.add_edge("memory", "personality")
workflow.add_edge("personality", "llm")

# Conditional path from LLM
workflow.add_conditional_edges(
    "llm",
    should_continue,
    {
        "tools": "tools",
        "update_mem": "update_mem"
    }
)

# After tools, we go back to the LLM to summarize/respond
workflow.add_edge("tools", "llm")

# After memory update, we end
workflow.add_edge("update_mem", END)

# Compile the graph
rocky_brain_graph = workflow.compile()
