import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderInline } from "../components/react/inline";

function Subject({ text }: { text: string }) {
  return <p>{renderInline(text)}</p>;
}

describe("renderInline", () => {
  it("renders plain text literally", () => {
    render(<Subject text="hello world" />);
    expect(screen.getByText("hello world")).toBeDefined();
  });

  it("renders **bold** as <strong>", () => {
    const { container } = render(<Subject text="this is **bold** text" />);
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("bold");
  });

  it("renders *italic* as <em>", () => {
    const { container } = render(<Subject text="this is *italic* text" />);
    const em = container.querySelector("em");
    expect(em?.textContent).toBe("italic");
  });

  it("renders [label](url) as external link by default", () => {
    const { container } = render(
      <Subject text="see [the docs](https://example.com/docs)" />
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/docs");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders internal [label](/path) as <a> with no target by default", () => {
    const { container } = render(
      <Subject text="see [home](/home)" />
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/home");
    expect(anchor?.getAttribute("target")).toBeNull();
  });

  it("uses LinkComponent for internal links when provided", () => {
    function FakeLink({ href, children }: { href: string; children: React.ReactNode }) {
      return (
        <a href={href} data-internal-link>
          {children}
        </a>
      );
    }
    function S() {
      return (
        <p>
          {renderInline("[home](/home) vs [docs](https://example.com)", {
            LinkComponent: FakeLink,
          })}
        </p>
      );
    }
    const { container } = render(<S />);
    const internal = container.querySelector("[data-internal-link]");
    const external = container.querySelectorAll("a")[1];
    expect(internal?.getAttribute("href")).toBe("/home");
    expect(external?.getAttribute("href")).toBe("https://example.com");
    expect(external?.hasAttribute("data-internal-link")).toBe(false);
  });

  it("supports nested **bold *italic***", () => {
    const { container } = render(
      <Subject text="**bold *italic* end**" />
    );
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    const em = strong?.querySelector("em");
    expect(em?.textContent).toBe("italic");
  });

  it("renders unterminated **bold as literal text", () => {
    render(<Subject text="this has **no close" />);
    expect(screen.getByText(/this has \*\*no close/)).toBeDefined();
  });

  it("renders unterminated [link as literal text", () => {
    render(<Subject text="this has [no close" />);
    expect(screen.getByText(/this has \[no close/)).toBeDefined();
  });

  it("handles multiple inline elements in one string", () => {
    const { container } = render(
      <Subject text="A **bold** word, an *italic* word, a [link](https://x)" />
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://x"
    );
  });
});
