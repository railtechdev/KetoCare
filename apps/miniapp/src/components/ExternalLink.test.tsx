import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BreakableUrl, ExternalLink } from "./ExternalLink";

describe("адрес кабинета на экране", () => {
  it("переносится только на границах частей, а не посреди порта", () => {
    // `break-all` рвал «http://localhost:51 / 75» — порт читался двумя числами.
    const { container } = render(
      <ExternalLink href="http://localhost:5175/join">
        <BreakableUrl url="http://localhost:5175/join" />
      </ExternalLink>,
    );

    const link = screen.getByRole("link", {
      name: "http://localhost:5175/join",
    });
    expect(link).not.toHaveClass("break-all");
    const pieces = [...container.querySelector("a")!.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent);
    expect(pieces).toEqual(["http://", "localhost:5175", "/join"]);
  });
});
