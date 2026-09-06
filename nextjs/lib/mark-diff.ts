/**
 * Which mark rows actually moved.
 *
 * The diff is between two value maps — what the teacher has on screen, and
 * what Odoo last confirmed — rather than between a form field and a hidden
 * companion field carrying the value it was rendered with.
 *
 * That indirection is what made this worth extracting. The grid auto-saves,
 * and React 19 resets a form once its action returns, so the visible controls
 * were being restored to the values the page was *rendered* with while the
 * hidden baselines had already been refreshed by revalidation. The next
 * auto-save then diffed a stale control against a fresh baseline and wrote the
 * old value back over the teacher's entry. Diffing state against state cannot
 * express that bug: both halves move together or not at all.
 */

export interface MarkValues {
  score: string
  status: string
  note: string
}

export interface MarkWrite {
  score?: number
  mark_status?: string
  note?: string
}

export interface MarkChange {
  markId: number
  values: MarkWrite
}

/**
 * The rows whose entry fields differ from the last confirmed state.
 *
 * A blank score is "not entered yet", not "set this back to nothing":
 * `school.mark` has no way to un-record a score once one exists, so a cleared
 * box is left alone rather than sent as zero.
 */
export function changedRows(
  current: Record<number, MarkValues>,
  baseline: Record<number, MarkValues>,
): MarkChange[] {
  const changes: MarkChange[] = []

  for (const [key, row] of Object.entries(current)) {
    const markId = Number(key)
    const was = baseline[markId]
    if (!was) continue

    const values: MarkWrite = {}
    const score = row.score.trim()

    if (score !== '' && score !== was.score.trim()) {
      const parsed = Number(score)
      if (Number.isFinite(parsed)) values.score = parsed
    }
    if (row.status !== '' && row.status !== was.status) {
      values.mark_status = row.status
    }
    if (row.note !== was.note) {
      values.note = row.note
    }

    if (Object.keys(values).length > 0) changes.push({ markId, values })
  }

  return changes
}
