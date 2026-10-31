import { Component } from "react";

/// 单个视图的兜底边界（2026-10-23 加）。
/// 起因：InflightView 里一行自引用（const step = ... Number(step) ...）在渲染时抛错，
/// 因为「在途」是默认页签，整个窗口直接白屏，连顶部页签都点不到。
/// 规则：任何单页崩掉都不许带走整窗，其余页签必须还能切。
export default class ViewBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("view crashed:", error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: "52px 34px", maxWidth: 620 }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 8 }}>这个页面渲染失败</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.75, opacity: 0.72 }}>
            其余页面不受影响，可以在顶部切换。
            <br />
            错误：{String(error?.message || error)}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, fontSize: 12.5, padding: "6px 14px", cursor: "pointer" }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
