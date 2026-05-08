import asyncio
import json
import structlog
import litellm
from typing import Any, Dict, List, Optional
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from .state import RockyState
from ...bridges import letta_bridge
from ...core.redis_client import get_redis
from ...rocky.personality import system_prompt, emotional_states, intimacy
from ...tools import executor, definitions
from ...config import settings
from langchain_community.chat_models import ChatLiteLLM

log = structlog.get_logger()

async def retrieve_memory(state: RockyState) -> Dict[str, Any]:
    """
    Node: Fetches Core and Archival memory from Letta.
    """
    sid = state.get("sid", "default")
    log.info("node_retrieve_memory", sid=sid)
    
    core_memory = await letta_bridge.get_core_memory() or {}
    
    # Archival search based on the last human message
    last_user_msg = next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
    recent_context = []
    if last_user_msg:
        recent_context = await letta_bridge.search_archival(last_user_msg, limit=5)
    
    return {
        "core_memory": core_memory,
        "recent_context": recent_context
    }

async def inject_personality(state: RockyState) -> Dict[str, Any]:
    """
    Node: Loads emotional state/intimacy and constructs the dynamic SystemMessage.
    """
    sid = state.get("sid", "default")
    redis = await get_redis()
    
    # Load state from Redis
    emo = await emotional_states.load(sid, redis)
    score = await intimacy.load(sid, redis)
    
    # Update emotional state based on last message (if any)
    last_msg = state["messages"][-1].content if state["messages"] else ""
    if last_msg:
        emo = await emotional_states.detect(last_msg, current=emo)
        score = await intimacy.update(sid, last_msg, redis)
        await emotional_states.save(sid, emo, redis)

    # Build prompt
    human_context = state["core_memory"].get("human", {}).get("value", "")
    persona_context = state["core_memory"].get("persona", {}).get("value", "")
    
    # Add Letta memory context to the system prompt if available
    home_summary = "All systems normal." # Fallback or fetch from HA status node if we had one
    
    full_system_prompt = system_prompt.build_system_prompt(
        emotional_state=emo,
        intimacy_score=score,
        message=last_msg,
        home_summary=home_summary
    )
    
    # Append Letta specifics if they differ from base
    if human_context:
        full_system_prompt += f"\n\n## Known about Human (from Memory)\n{human_context}"
    
    # Add archival context if relevant
    if state["recent_context"]:
        context_str = "\n".join([f"- {m.get('text', '')}" for m in state["recent_context"]])
        full_system_prompt += f"\n\n## Relevant Past Conversations\n{context_str}"

    return {
        "messages": [SystemMessage(content=full_system_prompt)],
        "emotional_state": emo,
        "intimacy_score": int(score)
    }

async def llm_reasoning(state: RockyState) -> Dict[str, Any]:
    """
    Node: Invokes the LLM with tool binding using ChatLiteLLM.
    """
    model = settings.get_llm_model() or "groq/llama-3.1-8b-instant"
    
    # Bind tools from registry
    tools = await definitions.get_tools()
    
    log.info("node_llm_reasoning", model=model, tools_count=len(tools))
    
    # Initialize ChatLiteLLM
    # We pass the model directly, LiteLLM handles the routing (groq/, openai/, etc)
    llm = ChatLiteLLM(
        model=model,
        temperature=0.7,
        streaming=True
    )
    
    # Bind tools if any
    if tools:
        # ChatLiteLLM supports bind_tools in a way compatible with OpenAI tools
        llm = llm.bind_tools(tools)

    # Invoke LLM
    # When using astream_events, this call will trigger "on_chat_model_stream" events
    response = await llm.ainvoke(state["messages"])
    
    log.info("node_llm_response", content=response.content[:50] if response.content else "TOOLS_CALLED")
    
    # Extract tool calls from AIMessage if any
    # LangChain's AIMessage already has a .tool_calls attribute if bound tools were used
    return {
        "messages": [response]
    }

async def execute_tools(state: RockyState) -> Dict[str, Any]:
    """
    Node: Executes tool calls found in the last message.
    """
    last_message = state["messages"][-1]
    if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
        return {}

    tool_messages = []
    tools_called = []
    
    for tool_call in last_message.tool_calls:
        name = tool_call["name"]
        args = tool_call["args"]
        tool_id = tool_call["id"]
        
        log.info("node_execute_tool", name=name, tool_id=tool_id)
        tools_called.append(name)
        
        # Execute tool
        # Note: we might need to pass sio if we want real-time timer feedback, 
        # but for now we keep it simple.
        result = await executor.run(name, args, bypass_auth=True)
        
        if isinstance(result, dict) and result.get("status") == "pending_auth":
            result_str = "ACTION PENDING: Human confirmation required."
        else:
            result_str = str(result)
            
        tool_messages.append(ToolMessage(
            content=result_str,
            tool_call_id=tool_id
        ))

    return {
        "messages": tool_messages,
        "tools_called": tools_called
    }

async def update_memory(state: RockyState) -> Dict[str, Any]:
    """
    Node: Background update of Letta memory.
    """
    # This is a background task, but in the graph it's a node.
    # We evaluate the exchange and decide if something worth remembering happened.
    last_user_msg = next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
    last_ai_msg = next((m.content for m in reversed(state["messages"]) if isinstance(m, AIMessage)), "")
    
    if last_user_msg and last_ai_msg:
        # Simple heuristic: if tools were used or it's a long exchange, maybe archival?
        # Letta's own internal logic would handle this if we used its chat endpoint,
        # but here we just manually insert into archival if we want.
        # For now, let's just log it.
        log.info("node_update_memory", sid=state.get("sid"))
        
    return {"next_step": "END"}
