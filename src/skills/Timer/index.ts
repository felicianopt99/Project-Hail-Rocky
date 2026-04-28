import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { RockyEvents } from "../../lib/eventBus";

interface ActiveTimer {
  id: string;
  label: string;
  duration_seconds: number;
  startedAt: number;
  timeout: NodeJS.Timeout;
}

export class TimerSkill extends BaseSkill {
  private activeTimers: Map<string, ActiveTimer> = new Map();

  getDefinition(): SkillDefinition {
    const active = Array.from(this.activeTimers.values())
      .map(t => {
        const remaining = Math.max(0, t.duration_seconds - Math.floor((Date.now() - t.startedAt) / 1000));
        return `${t.label} (${remaining}s left)`;
      })
      .join(", ");

    return {
      name: "set_timer",
      description:
        `Set a countdown timer or alarm. ` +
        `When the timer fires, the user gets a notification. ` +
        `Active timers: ${active || "none"}. ` +
        `Use for: "remind me in 5 minutes", "set a 20 minute timer", "timer for pasta".`,
      parameters: {
        type: "object",
        properties: {
          duration_seconds: {
            type: "number",
            description: "Duration in seconds. Convert minutes/hours to seconds (5min=300, 1h=3600).",
          },
          label: {
            type: "string",
            description: "What this timer is for, e.g. 'pasta', 'meeting', 'break'.",
          },
          action: {
            type: "string",
            enum: ["set", "cancel", "list"],
            description: "set = create timer, cancel = stop a timer by label, list = show active timers.",
          },
        },
        required: ["action"],
      },
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { action, duration_seconds, label } = args;

    if (action === "list") {
      const timers = Array.from(this.activeTimers.values()).map(t => {
        const remaining = Math.max(0, t.duration_seconds - Math.floor((Date.now() - t.startedAt) / 1000));
        return { label: t.label, remaining_seconds: remaining };
      });
      return {
        success: true,
        data: timers,
        message: timers.length > 0
          ? `Active timers: ${timers.map(t => `${t.label} (${t.remaining_seconds}s)`).join(", ")}.`
          : "No active timers.",
      };
    }

    if (action === "cancel") {
      if (!label) return { success: false, message: "Need a label to cancel." };
      const found = Array.from(this.activeTimers.entries())
        .find(([, t]) => t.label.toLowerCase() === label.toLowerCase());
      if (!found) return { success: false, message: `No timer found with label "${label}".` };
      clearTimeout(found[1].timeout);
      this.activeTimers.delete(found[0]);
      return { success: true, message: `Timer "${label}" cancelled.` };
    }

    // action === "set"
    if (!duration_seconds || duration_seconds <= 0) {
      return { success: false, message: "Duration must be a positive number of seconds." };
    }

    const id = `timer_${Date.now()}`;
    const timerLabel = label || "Timer";

    const timeout = setTimeout(() => {
      this.activeTimers.delete(id);
      // Emit event when timer fires
      context.events.emit(RockyEvents.UI_HINT, { 
        sessionId: context.sessionId, 
        type: "timer_fired", 
        data: { id, label: timerLabel } 
      });
    }, duration_seconds * 1000);

    const timer: ActiveTimer = {
      id,
      label: timerLabel,
      duration_seconds,
      startedAt: Date.now(),
      timeout,
    };

    this.activeTimers.set(id, timer);

    const minutes = Math.floor(duration_seconds / 60);
    const seconds = duration_seconds % 60;
    const timeStr = minutes > 0
      ? `${minutes}m${seconds > 0 ? ` ${seconds}s` : ""}`
      : `${seconds}s`;

    return {
      success: true,
      message: `Timer "${timerLabel}" set for ${timeStr}. I will notify you, yes.`,
    };
  }

  cancelTimer(id: string) {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearTimeout(timer.timeout);
      this.activeTimers.delete(id);
    }
  }
}
