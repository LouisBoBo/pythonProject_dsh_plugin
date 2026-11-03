/** 十步注册表：顺序固定，与 STEP_IDS 一一对应。 */

import { STEP_SKILLS, STEP_TITLES, type StepContext, type StepDefinition, type StepResult } from '../types.js'
import { runStep1 } from './step1.js'
import { runStep2 } from './step2.js'
import { runStep3 } from './step3.js'
import { runStep4 } from './step4.js'
import { runStep5 } from './step5.js'
import { runStep6 } from './step6.js'
import { runStep7 } from './step7.js'
import { runStep8 } from './step8.js'
import { runStep9 } from './step9.js'
import { runStep10 } from './step10.js'

const RUNNERS: Record<string, (sc: StepContext) => Promise<StepResult>> = {
  '1': runStep1,
  '2': runStep2,
  '3': runStep3,
  '4': runStep4,
  '5': runStep5,
  '6': runStep6,
  '7': runStep7,
  '8': runStep8,
  '9': runStep9,
  '10': runStep10,
}

export const STEPS: StepDefinition[] = Object.entries(RUNNERS).map(([id, run]) => {
  const stepId = id as StepDefinition['id']
  return {
    id: stepId,
    skill: STEP_SKILLS[stepId],
    title: STEP_TITLES[stepId],
    run,
  }
})

export function stepDefinition(id: string): StepDefinition | undefined {
  return STEPS.find((s) => s.id === id)
}
