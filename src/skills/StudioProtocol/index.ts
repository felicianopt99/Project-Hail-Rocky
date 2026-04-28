import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { aliasService } from "../../services/aliasService";

export class StudioProtocolSkill extends BaseSkill {
  getDefinition(context: RockyContext): SkillDefinition {
    const protocols = aliasService.getAvailableAliases();
    
    return {
      name: "activate_studio_protocol",
      description: 
        "Activates a high-level studio environment preset (protocol). " +
        "Use this for 'modes' or 'vibes' rather than individual device control. " +
        "Example: 'Activate Techno Mode', 'Cinema Mode', 'I am recording'.",
      parameters: {
        type: "object",
        properties: {
          protocol_name: {
            type: "string",
            description: "The name of the protocol to activate.",
            enum: protocols
          }
        },
        required: ["protocol_name"]
      }
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { protocol_name } = args;
    
    const resolvedIds = aliasService.resolveLightAlias(protocol_name);
    if (!resolvedIds) {
      return {
        success: false,
        message: `Protocol "${protocol_name}" not found in neural registry. Bad math!`
      };
    }

    // Execute protocol logic (turning on all associated lights)
    const results = await Promise.all(
      resolvedIds.map(id => context.system.controlDevice(id, "on", { brightness: 100 }))
    );

    const ok = results.filter(Boolean).length;
    const success = ok > 0;

    // Phase 3 Step 4: Emit SHOW_WIDGET event
    context.events.emit("SHOW_WIDGET", {
      type: "suggestion", // We'll reuse the suggestion widget for protocol confirmation
      text: `Protocol ${protocol_name} activated successfully. Amaze!`,
      protocol: protocol_name,
      stats: {
        devices_affected: ok,
        total_devices: resolvedIds.length
      }
    });

    return {
      success,
      protocol: protocol_name,
      affected_devices: ok,
      message: success 
        ? `Protocol ${protocol_name} deployed. Neural alignment stable. Amaze!`
        : `Failed to deploy protocol ${protocol_name}. Hardware handshake failed.`
    };
  }
}
