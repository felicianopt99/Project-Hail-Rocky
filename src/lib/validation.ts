import { z } from "zod";

export const ControlDeviceSchema = z.object({
  device: z.string(),
  action: z.enum(["on", "off", "toggle", "set"]),
  params: z.object({
    brightness: z.number().min(0).max(100).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    color_temp_kelvin: z.number().min(1000).max(10000).optional(),
  }).optional(),
});

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  history: z.array(z.object({
    role: z.string(),
    text: z.string().optional(),
    content: z.string().optional(),
  })).optional(),
});

export const SaveProtocolSchema = z.object({
  id: z.string(),
  settings: z.any(),
});

export const CreateProtocolSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  settings: z.any().optional(),
});

export const DeleteProtocolSchema = z.object({
  id: z.string(),
});

export const SetSensitivitySchema = z.object({
  silenceThreshold: z.number().min(0).max(1),
  silenceTimeout: z.number().min(100).max(10000),
});

export const SetModeSchema = z.string().min(1).max(50);
