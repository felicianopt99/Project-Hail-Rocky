import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { aliasService } from "../../services/aliasService";

const SYSTEM_ROUTINES = ["home", "away", "night", "party"];

export class ExecuteRoutineSkill extends BaseSkill {
  getDefinition(context: RockyContext): SkillDefinition {
    const state = context.system.getState();
    const protocolIds = state.protocols.map((p: any) => p.id);
    const aliases = aliasService.getAvailableAliases();
    const allIds = [...new Set([...SYSTEM_ROUTINES, ...protocolIds, ...aliases])];

    return {
      name: "execute_routine",
      description:
        `Execute a smart home routine, activate a protocol, or trigger a named alias. ` +
        `System routines: home (all lights 100%), away (all lights off), night (dim warm 10%), party (music). ` +
        `Protocols: ${protocolIds.join(", ") || "none"}. ` +
        `Aliases: ${aliases.join(", ") || "none"}. ` +
        `Use when Friend says "I'm home", "good night", "cinema mode", "vou dormir", "party time", etc.`,
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Routine ID, protocol ID, or alias name to execute.",
            enum: allIds.length > 0 ? allIds : undefined,
          },
        },
        required: ["id"],
      },
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { id } = args;
    const state = context.system.getState();

    // 1. DB protocol
    const isProtocol = state.protocols.some((p: any) => p.id === id);
    if (isProtocol) {
      await context.system.setMode(id);
      const proto = state.protocols.find((p: any) => p.id === id);
      return { success: true, message: `Protocol "${proto?.label || id}" deployed. Environment adjusting, yes.` };
    }

    // 2. System routine
    if (SYSTEM_ROUTINES.includes(id)) {
      await context.system.executeRoutine(id);
      return { success: true, message: `Routine "${id}" executed. All nodes responding, yes.` };
    }

    // 3. Alias fallback (e.g. studio named groups from aliases.json)
    const resolvedIds = aliasService.resolveLightAlias(id);
    if (resolvedIds) {
      await Promise.all(resolvedIds.map(entity => context.system.controlDevice(entity, "on", { brightness: 100 })));
      return { success: true, message: `Alias "${id}" activated. ${resolvedIds.length} nodes responding. Amaze!` };
    }

    return {
      success: false,
      message: `Unknown routine or protocol "${id}". Bad math! Available: ${[...SYSTEM_ROUTINES, ...state.protocols.map((p: any) => p.id)].join(", ")}.`,
    };
  }
}

