import { Component } from "react";
import { useLocation } from "react-router-dom";
import { isRecoverableLazyImportError } from "../utils/lazyWithRecovery.js";

class RouteErrorBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    const { children } = this.props;
    const { error } = this.state;

    if (!error) {
      return children;
    }

    const recoverableImportError = isRecoverableLazyImportError(error);
    const title = recoverableImportError ? "Страница обновляется" : "Страница не открылась";
    const description = recoverableImportError
      ? "Фронтенд был пересобран, и браузер потерял старый файл страницы. Обнови вкладку, чтобы загрузить свежую версию."
      : "Во время открытия страницы произошла ошибка рендера. Попробуй повторить еще раз или обновить вкладку.";

    return (
      <div
        style={{
          marginTop: "16px",
          padding: "20px",
          borderRadius: "20px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.04)",
          color: "rgba(255, 255, 255, 0.92)",
          display: "grid",
          gap: "12px",
          maxWidth: "720px",
        }}
      >
        <div style={{ display: "grid", gap: "6px" }}>
          <strong style={{ fontSize: "22px", lineHeight: 1.1 }}>{title}</strong>
          <p style={{ margin: 0, color: "rgba(255, 255, 255, 0.68)", lineHeight: 1.5 }}>{description}</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              minHeight: "40px",
              padding: "0 16px",
              borderRadius: "999px",
              border: "none",
              background: "rgba(255, 255, 255, 0.12)",
              color: "rgba(255, 255, 255, 0.92)",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Повторить
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              minHeight: "40px",
              padding: "0 16px",
              borderRadius: "999px",
              border: "none",
              background: "#f5cc46",
              color: "#181206",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Обновить вкладку
          </button>
        </div>
      </div>
    );
  }
}

export default function RouteErrorBoundary({ children }) {
  const location = useLocation();

  return <RouteErrorBoundaryInner resetKey={`${location.pathname}${location.search}`}>{children}</RouteErrorBoundaryInner>;
}
