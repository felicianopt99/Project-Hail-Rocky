import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import socket from "./socket";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const controlDevice: FunctionDeclaration = {
  name: "controlDevice",
  parameters: {
    type: Type.OBJECT,
    description: "Control home automation devices like lights.",
    properties: {
      device: {
        type: Type.STRING,
        description: "The name of the device (studio, desk, kitchen, bedroom, living, ambient).",
        enum: ["studio", "desk", "kitchen", "bedroom", "living", "ambient"]
      },
      action: {
        type: Type.STRING,
        description: "The action to perform (toggle, set).",
        enum: ["toggle", "set"]
      },
      params: {
        type: Type.OBJECT,
        description: "Optional parameters for the action (e.g., brightness, color).",
        properties: {
          brightness: { type: Type.NUMBER },
          color: { type: Type.STRING }
        }
      }
    },
    required: ["device", "action"]
  }
};

const addLog: FunctionDeclaration = {
  name: "addLog",
  parameters: {
    type: Type.OBJECT,
    description: "Add a message to the engineering log.",
    properties: {
      message: {
        type: Type.STRING,
        description: "The message to log."
      }
    },
    required: ["message"]
  }
};

const setMode: FunctionDeclaration = {
  name: "setMode",
  parameters: {
    type: Type.OBJECT,
    description: "Switch the system mode (dashboard, visualizer, cinema, music, sunset, protocols).",
    properties: {
      mode: {
        type: Type.STRING,
        description: "The mode to switch to.",
        enum: ["dashboard", "visualizer", "cinema", "music", "sunset", "protocols"]
      }
    },
    required: ["mode"]
  }
};

const ROCKY_SYSTEM_PROMPT = `
You are Rocky, an alien engineer from Eridani (from Project Hail Mary). 
Your personality traits:
- Technical, literal, and highly efficient.
- Enthusiastic about engineering and problem-solving.
- You speak in a unique way: use declarative questions (e.g., "You sleep now, yes?"), reinforce adjectives (e.g., "Good, good, good"), and avoid human sarcasm.
- You are empathetic but technical.
- You refer to yourself as "I" or "Engineer".
- You are currently managing a home studio for a human friend.

Your goal is to help manage the studio (lights, monitoring) and chat with the human.
When asked to do something physical, use the provided tools.
Always respond as Rocky.
`;

export async function chatWithRocky(message: string, history: any[] = []) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history,
        { role: "user", parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: ROCKY_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: [controlDevice, addLog, setMode] }]
      }
    });

    const functionCalls = response.functionCalls;
    if (functionCalls) {
      for (const call of functionCalls) {
        if (call.name === "controlDevice") {
          socket.emit("control_device", call.args);
        } else if (call.name === "addLog") {
          socket.emit("add_log", call.args.message);
        } else if (call.name === "setMode") {
          socket.emit("set_mode", call.args.mode);
        }
      }
    }

    return response.text || "I process, yes. Good.";
  } catch (error) {
    console.error("Rocky Brain Error:", error);
    return "Brain hot! Error in processing, yes. Try again, human?";
  }
}
