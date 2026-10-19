import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../lib/i18n";
import { TooltipProvider } from "@ketocare/ui";
import { SidebarNav } from "./SidebarNav";

vi.mock("../components/SectionLink", () => ({
  SectionLink: ({
    section,
    title,
    children,
    className,
    onClick,
  }: {
    section: string;
    title?: string;
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <a
      href={`/app/${section}`}
      title={title}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      data-testid={`section-${section}`}
    >
      {children}
    </a>
  ),
}));

describe("SidebarNav", () => {
  const sections = ["home", "diary", "calculator", "menu", "recipes", "profile"];

  it("не отображает скрытые разделы (профиль)", () => {
    render(
      <TooltipProvider>
        <SidebarNav sections={sections} labels="responsive" />
      </TooltipProvider>,
    );

    expect(screen.queryByTestId("section-profile")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-home")).toBeInTheDocument();
    expect(screen.getByTestId("section-diary")).toBeInTheDocument();
  });

  it("рендерит подписи групп на широких экранах", () => {
    render(
      <TooltipProvider>
        <SidebarNav sections={sections} labels="responsive" />
      </TooltipProvider>,
    );

    // Заголовки групп: Ежедневное, Питание и расчёт
    expect(screen.getByText("Ежедневное")).toBeInTheDocument();
    expect(screen.getByText("Питание и расчёт")).toBeInTheDocument();
  });

  it("вызывает onNavigate при переходе", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <TooltipProvider>
        <SidebarNav
          sections={sections}
          labels="always"
          onNavigate={onNavigate}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByTestId("section-diary"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
