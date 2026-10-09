import { ownerQuestions, questionStatusLabels, type QuestionId } from '../../demo/ownerQuestions';
import { Badge } from '../../shared/ui';

export function OwnerQuestions({ ids }: { ids: readonly QuestionId[] }) {
  if (!ids.length) return null;
  return <details className="owner-questions">
    <summary>Para conversar con la dueña</summary>
    <p className="muted">Estas decisiones siguen pendientes; la demo no las confirma.</p>
    <ul>{ids.map(id => {
      const item = ownerQuestions[id];
      return <li key={id}>
        <Badge tone={item.status === 'provisional' ? 'warning' : 'neutral'}>{questionStatusLabels[item.status]}</Badge>
        <h3>{id} · {item.question}</h3><p>{item.note}</p>
      </li>;
    })}</ul>
  </details>;
}
