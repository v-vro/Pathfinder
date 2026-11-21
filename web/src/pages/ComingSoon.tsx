import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import { SectionHeader } from "../components/SectionHeader";
import "./pages.css";

export interface ComingSoonProps {
  title: string;
  description: string;
  eyebrow?: string;
}

/** Placeholder page body inside the shared layout. */
export default function ComingSoon({
  title,
  description,
  eyebrow = "In progress",
}: ComingSoonProps) {
  return (
    <section className="pf-container page-soon">
      <Panel padding="lg" variant="raised" className="page-soon__panel">
        <Badge tone="primary" dot>
          Coming soon
        </Badge>
        <SectionHeader as="h1" eyebrow={eyebrow} title={title} description={description} />
        <div className="page-soon__actions">
          <Button to="/" variant="secondary">
            Back to home
          </Button>
          <Button to="/#how-it-works" variant="ghost">
            How it works
          </Button>
        </div>
      </Panel>
    </section>
  );
}
