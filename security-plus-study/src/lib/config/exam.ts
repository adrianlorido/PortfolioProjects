/**
 * Exam simulator configuration. CompTIA can change exam rules at any time, so
 * nothing about the exam format is hardcoded in the engine: edit this file.
 */
export interface ExamPreset {
  id: string;
  name: string;
  description: string;
  questionCount: number;
  timeLimitMinutes: number;
}

export interface ExamConfig {
  examCode: string;
  /** Scaled score range used for the estimated score report. */
  scaleMin: number;
  scaleMax: number;
  passingScaledScore: number;
  /** Seconds after expiry during which answers saved late are still accepted. */
  gracePeriodSeconds: number;
  /** Distribute questions by domain weight (true) or sample uniformly (false). */
  useDomainWeights: boolean;
  presets: ExamPreset[];
  defaultPresetId: string;
}

export const EXAM_CONFIG: ExamConfig = {
  examCode: "SY0-701",
  scaleMin: 100,
  scaleMax: 900,
  passingScaledScore: 750,
  gracePeriodSeconds: 30,
  useDomainWeights: true,
  defaultPresetId: "full",
  presets: [
    {
      id: "full",
      name: "Full exam simulation",
      description: "Full-length practice exam that mirrors the real test's length and pacing.",
      questionCount: 90,
      timeLimitMinutes: 90,
    },
    {
      id: "half",
      name: "Half-length exam",
      description: "Same pacing, half the length. Great for a focused evening session.",
      questionCount: 45,
      timeLimitMinutes: 45,
    },
    {
      id: "sprint",
      name: "Exam sprint",
      description: "A 20-question timed set to practice pacing under pressure.",
      questionCount: 20,
      timeLimitMinutes: 20,
    },
  ],
};

export function getExamPreset(id: string): ExamPreset {
  return EXAM_CONFIG.presets.find((p) => p.id === id) ?? EXAM_CONFIG.presets[0];
}
