'use client'

import { useActionState } from 'react'
import { Badge, Button, EmptyState } from '@/components/ui'
import { Field, FormError, FormSuccess, INPUT_CLASS, useFormResponse } from '@/components/ui/form'
import { saveAnswersAction, type AnswerState } from '../actions'

export interface QuestionView {
  id: number
  name: string
  answerType: string
  required: boolean
  options: Array<{ id: number; name: string }>
  answerId: number | null
  valueText: string
  optionId: string
}

/**
 * The registration questionnaire, answered where the refusal happens.
 *
 * Odoo blocks submission naming every applicable required question left
 * unanswered. The list here comes from the same domain that check uses, so it
 * can neither ask for something the check ignores nor omit something it wants.
 *
 * Each row posts what it was rendered with as `was-*`, so saving writes only
 * the answers that actually moved.
 */
export function Questionnaire({
  studentId,
  questions,
  canWrite,
}: {
  studentId: number
  questions: QuestionView[]
  canWrite: boolean
}) {
  const [state, formAction, pending] = useActionState<AnswerState, FormData>(
    saveAnswersAction,
    {},
  )

  /*
    A refusal part-way through the roster leaves the earlier answers written
    and the later ones not. Re-seeding from the submission is what keeps the
    unsaved ones on screen — otherwise they revert to the stored value and
    read as though they had been saved.
  */
  const answer = (field: string) => state.values?.[field]
  const response = useFormResponse(state)

  if (questions.length === 0) {
    return (
      <EmptyState
        title="No questions apply"
        hint="Nothing in the questionnaire matches this student's grade, admission type and stream."
      />
    )
  }

  const unanswered = questions.filter(
    (q) => q.required && !q.valueText && !q.optionId,
  ).length

  return (
    <form action={formAction} className="space-y-4 px-6 pb-6">
      <input type="hidden" name="studentId" value={studentId} />
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.ok}</FormSuccess>

      {unanswered > 0 ? (
        <p className="text-[12px] text-danger">
          {unanswered} required {unanswered === 1 ? 'question is' : 'questions are'} unanswered,
          so Odoo will refuse to submit this registration.
        </p>
      ) : null}

      <div className="space-y-4">
        {questions.map((question) => (
          <div key={question.id}>
            <input type="hidden" name="questionId" value={question.id} />
            {question.answerId ? (
              <input type="hidden" name={`answerId-${question.id}`} value={question.answerId} />
            ) : null}
            <input
              type="hidden"
              name={`was-text-${question.id}`}
              value={question.valueText}
            />
            <input
              type="hidden"
              name={`was-option-${question.id}`}
              value={question.optionId}
            />

            <Field
              label={question.name}
              htmlFor={
                question.answerType === 'selection'
                  ? `option-${question.id}`
                  : `text-${question.id}`
              }
              required={question.required}
            >
              {question.answerType === 'selection' ? (
                <select
                  key={`option-${question.id}-${response}`}
                  id={`option-${question.id}`}
                  name={`option-${question.id}`}
                  defaultValue={answer(`option-${question.id}`) ?? question.optionId}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                >
                  <option value="">Not answered</option>
                  {question.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              ) : question.answerType === 'boolean' ? (
                <select
                  key={`text-${question.id}-${response}`}
                  id={`text-${question.id}`}
                  name={`text-${question.id}`}
                  defaultValue={answer(`text-${question.id}`) ?? question.valueText}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                >
                  <option value="">Not answered</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input
                  id={`text-${question.id}`}
                  name={`text-${question.id}`}
                  type={
                    question.answerType === 'date'
                      ? 'date'
                      : question.answerType === 'integer'
                        ? 'number'
                        : 'text'
                  }
                  defaultValue={answer(`text-${question.id}`) ?? question.valueText}
                  disabled={!canWrite}
                  className={INPUT_CLASS}
                />
              )}
            </Field>

            {question.required ? null : (
              <Badge tone="muted">Optional</Badge>
            )}
          </div>
        ))}
      </div>

      {canWrite ? (
        <Button type="submit" pending={pending}>
          {pending ? 'Saving…' : 'Save answers'}
        </Button>
      ) : null}
    </form>
  )
}
