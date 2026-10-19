import type { Meeting } from "./types.js";
import { parseTranscript } from "./transcript.js";

/**
 * A synthetic sample meeting used by the demo and tests. Entirely fictional -
 * it just exercises the pipeline with realistic shape (terse notes + a
 * multi-speaker transcript with microphone/system audio).
 */

const RAW_TRANSCRIPT = `Microphone
Speaker A: Bom dia pessoal, vamos ao briefing do turno da noite.
Speaker A: Temos 48 reservas confirmadas e dois grupos grandes.
System audio
Speaker B: O grupo das 20h é de 12 pessoas, mesa comprida no salão.
Speaker A: Isso. Precisamos deixar a mesa 14 montada até as sete e meia.
Speaker C: Tem uma alergia a amendoim na mesa 9, já avisei a cozinha.
Speaker A: Ótimo. Quem não souber um prato, diz que não sabe, não inventa.
Speaker B: Os canudos de agave novos são só para as mesas redondas, 30 a 32.
Speaker A: Exato. E sempre perguntar sobre a garrafa de água antes de trazer outra.
Speaker C: A máquina de café do bar precisa de limpeza, está saindo fraco.
Speaker A: Pede manutenção hoje. Vamos fazer um serviço limpo e rápido.`;

export const sampleMeeting: Meeting = {
  id: "demo-0001",
  title: "Briefing do turno da noite",
  meetingAt: "2026-10-18T19:00:00-03:00",
  participants: [
    { name: "Ana", email: "ana@example.com", isNoteCreator: true },
    { name: "Bruno", email: "bruno@example.com" },
    { name: "Carla", email: "carla@example.com" },
  ],
  folders: [
    { id: "f1", title: "Briefings", visibility: "private" },
  ],
  notes: [
    "48 reservas, 2 grupos grandes",
    "grupo 20h = 12 pessoas, mesa 14 montada até 19h30",
    "alergia amendoim mesa 9",
    "canudos agave só mesas 30-32",
    "perguntar água antes de trazer outra garrafa",
    "café do bar: pedir manutenção",
  ].join("\n"),
  transcript: parseTranscript(RAW_TRANSCRIPT),
};
