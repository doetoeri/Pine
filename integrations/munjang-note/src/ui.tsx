import { cloneElement, isValidElement, useEffect, useId, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Circle, CircleCheck, CircleDot, CircleHelp, Eraser, Filter as FilterIcon, Search, X } from 'lucide-react';
import {
  emptyFilter, EXAM_TYPES, PRIORITIES, PRIORITY_LABELS, STATE_LABELS, STATES,
  type Category, type Filter, type State, type Workspace,
} from './model';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return <button type="button" {...props} className={'button button-' + variant + ' ' + className} />;
}

export function Modal({ title, children, actions, onClose, wide = false }: { title: string; children: ReactNode; actions?: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby={id} className={'modal ' + (wide ? 'modal-wide' : '')} onCancel={(event) => {
    event.preventDefault();
    onClose();
  }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><div className="panel-actions">{actions}<Button variant="ghost" className="icon-button" aria-label="닫기" onClick={onClose}><X /></Button></div></div>
    {children}
  </dialog>;
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: string; children: ReactNode; className?: string }) {
  const id = useId();
  return <div className={'field ' + className}>
    <label className="field-label" htmlFor={id}>{label}</label>
    {isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
      ? cloneElement(children, { id, 'aria-describedby': hint ? id + '-hint' : undefined })
      : children}
    {hint && <span className="field-hint" id={id + '-hint'}>{hint}</span>}
  </div>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="search-box"><Search size={18} aria-hidden="true" /><input type="search" value={value}
    onChange={(event) => onChange(event.target.value)} aria-label={placeholder} placeholder={placeholder} /></div>;
}

export function PageIntro({ context, title, subtitle, children }: { context?: string; title: string; subtitle?: string; children?: ReactNode }) {
  return <header className="page-intro">
    <div>{context && <div className="eyebrow">{context}</div>}
      <h1>{title}</h1>{subtitle && <p>{subtitle}</p>}
    </div>
    {children && <div className="page-actions">{children}</div>}
  </header>;
}

export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon" aria-hidden="true"><CircleHelp size={24} /></div>
    <h3>{title}</h3>{text && <p>{text}</p>}{children}
  </div>;
}

export const colorStyle = (category: Category): CSSProperties => ({ '--category': category.color } as CSSProperties);

export function CategoryChip({ category, children }: { category: Category; children?: ReactNode }) {
  return <span className="category-chip" style={colorStyle(category)}><span className={'mark-sample mark-' + category.mark} aria-hidden="true">Aa</span>
    {children ?? category.label}</span>;
}

const stateIcons = { unlearned: Circle, assisted: CircleDot, independent: CircleCheck, reviewed: CircleCheck };
export function StatePill({ state }: { state: State }) {
  const Icon = stateIcons[state];
  return <span className={'state-pill state-' + state}><Icon size={14} aria-hidden="true" />{STATE_LABELS[state]}</span>;
}

export function FilterFields({ filter, onChange, data, hideDocument = false, compact = false }: {
  filter: Filter; onChange: (filter: Filter) => void; data: Workspace; hideDocument?: boolean; compact?: boolean;
}) {
  const details = data.categories.filter((category) => !filter.categoryId || filter.categoryId === category.id);
  const fields = <>
    {!hideDocument && <Field label="지문"><select value={filter.documentId} onChange={(event) => onChange({ ...filter, documentId: event.target.value })}>
      <option value="">모든 지문</option>{data.documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}
    </select></Field>}
    <Field label="혼동 유형"><select value={filter.categoryId} onChange={(event) => onChange({ ...filter, categoryId: event.target.value, detailId: '' })}>
      <option value="">모든 유형</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
    </select></Field>
    <Field label="세부 유형"><select value={filter.detailId} onChange={(event) => onChange({ ...filter, detailId: event.target.value })}>
      <option value="">모든 세부 유형</option>{details.map((category) => <optgroup key={category.id} label={category.label}>
        {category.details.map((detail) => <option key={detail.id} value={detail.id}>{detail.label}</option>)}
      </optgroup>)}
    </select></Field>
    <Field label="학습 상태"><select value={filter.state} onChange={(event) => onChange({ ...filter, state: event.target.value })}>
      <option value="">모든 상태</option>{STATES.map((state) => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
    </select></Field>
    <Field label="중요도"><select value={filter.priority} onChange={(event) => onChange({ ...filter, priority: event.target.value })}>
      <option value="">모든 중요도</option>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
    </select></Field>
    <Field label="출제 유형"><select value={filter.exam} onChange={(event) => onChange({ ...filter, exam: event.target.value })}>
      <option value="">모든 출제 유형</option>{EXAM_TYPES.map((exam) => <option key={exam}>{exam}</option>)}
    </select></Field>
  </>;
  const hasFilter = Object.values(filter).some(Boolean);
  return <div className={'filter-box ' + (compact ? 'compact' : '')}>
    <div className="filter-heading"><span><FilterIcon size={15} />필터</span>
      {hasFilter && <Button variant="ghost" onClick={() => onChange({ ...emptyFilter })}><Eraser size={15} />초기화</Button>}</div>
    <div className="filter-fields">{fields}</div>
  </div>;
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(date));
}

export type Report = (message: string, error?: boolean) => void;
export function reportError(report: Report, error: unknown) {
  report(error instanceof Error ? error.message : '작업을 완료할 수 없어요.', true);
}
