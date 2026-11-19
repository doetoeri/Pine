import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { AI_FILE_MAX_BYTES, applyAIAnswers, parseAIAnswers } from './study-prompt';
import type { Commit } from './storage';
import { Button, reportError, type Report } from './ui';

export function AIImport({ commit, report }: { commit: Commit; report: Report }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return <>
    <Button disabled={busy} onClick={() => input.current?.click()}><Upload size={17} />AI 답변 불러오기</Button>
    <input ref={input} type="file" accept=".json,application/json" aria-label="AI 답변 JSON 파일" hidden onChange={async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setBusy(true);
      try {
        if (file.size > AI_FILE_MAX_BYTES) throw new Error('AI 답변 파일을 8MB 이하로 나눠 주세요.');
        const answers = parseAIAnswers(await file.text());
        let count = 0;
        let skipped = 0;
        await commit((previous) => {
          const result = applyAIAnswers(previous, answers);
          count = result.applied;
          skipped = result.skipped;
          return result.workspace;
        });
        if (!count) { report('일치하는 주석이 없어요. 파일을 만든 뒤 주석을 수정했다면 프롬프트를 다시 복사해 주세요.', true); return; }
        report('AI 답변 ' + count + '개를 불러왔어요.' + (skipped ? ' 일치하지 않은 답변 ' + skipped + '개는 건너뛰었어요.' : ''));
      } catch (error) { reportError(report, error); }
      finally { setBusy(false); }
    }} />
  </>;
}
