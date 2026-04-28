import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";

const DEFAULT_PLAYER = process.env.HA_MEDIA_PLAYER || "";

export class MediaControlSkill extends BaseSkill {
  getDefinition(_context: RockyContext): SkillDefinition {
    return {
      name: "control_media",
      description:
        "Control a media player (Spotify, Sonos, TV, Kodi, etc.) via Home Assistant. " +
        "Use when Friend wants to play, pause, stop, skip tracks, adjust media volume, " +
        "or turn a media device on/off. " +
        "Examples: 'play music', 'pause', 'next song', 'set volume to 50', 'turn off the TV'.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["play", "pause", "stop", "next", "previous", "volume_set", "volume_up", "volume_down", "turn_on", "turn_off", "select_source"],
            description: "Media player action to perform.",
          },
          entity_id: {
            type: "string",
            description:
              `Home Assistant entity_id of the media player (e.g. 'media_player.living_room'). ` +
              `Omit to use the default player${DEFAULT_PLAYER ? ` (${DEFAULT_PLAYER})` : ""}.`,
          },
          volume: {
            type: "number",
            minimum: 0,
            maximum: 100,
            description: "Volume level 0-100. Required for volume_set action.",
          },
          source: {
            type: "string",
            description: "Input source name. Required for select_source action.",
          },
        },
        required: ["action"],
      },
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { action, volume, source } = args;
    const entity = args.entity_id || DEFAULT_PLAYER;

    if (!entity) {
      return {
        success: false,
        message: "No media player entity specified. Set HA_MEDIA_PLAYER in .env or pass entity_id.",
      };
    }

    if (action === "volume_set" && (volume === undefined || volume === null)) {
      return { success: false, message: "volume_set requires a volume level (0-100)." };
    }

    const result = await context.system.controlMediaPlayer(entity, action, { volume, source });

    if (!result.success) {
      return { success: false, message: result.error || "Media player command failed. Bad math!" };
    }

    const label = entity.split(".")[1]?.replace(/_/g, " ") || entity;
    const confirmations: Record<string, string> = {
      play:          `Playing on ${label}. Good, good, good.`,
      pause:         `${label} paused.`,
      stop:          `${label} stopped.`,
      next:          `Next track on ${label}. Amaze!`,
      previous:      `Previous track on ${label}.`,
      volume_set:    `${label} volume → ${volume}%.`,
      volume_up:     `${label} volume increased.`,
      volume_down:   `${label} volume decreased.`,
      turn_on:       `${label} online. Yes.`,
      turn_off:      `${label} offline.`,
      select_source: `${label} source → ${source}.`,
    };

    return { success: true, message: confirmations[action] || `Media ${action} executed.` };
  }
}
