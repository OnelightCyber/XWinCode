import { Component, type ReactNode } from "react";
import { t } from "../../i18n";

interface Props {
  children: ReactNode;
  resetKey: unknown;
}

export class PreviewBoundary extends Component<Props, { error: string | null }> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="canvas-empty">
        <p>
          {t("canvas.crashed")} {this.state.error}
        </p>
        <button className="btn small" onClick={() => this.setState({ error: null })}>
          {t("canvas.retry")}
        </button>
      </div>
    );
  }
}
