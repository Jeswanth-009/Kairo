import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { useVaultStore } from "../stores/vaultStore";
import { useJobsStore } from "../stores/jobsStore";
import { useUiStore } from "../stores/uiStore";

function renderPalette(open = true) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <CommandPalette open={open} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe("CommandPalette", () => {
  afterEach(() => {
    cleanup();
    useUiStore.setState({ vaultFocus: null, vaultAction: null });
  });

  beforeEach(() => {
    useVaultStore.setState({
      projects: [
        {
          id: 7,
          title: "Payments API",
          description: "Ledger service",
          startDate: null,
          endDate: null,
          isCurrent: false,
          url: "",
          repoUrl: "",
          skills: [],
          evidenceCount: 0,
        },
      ],
      experiences: [],
      education: [],
      certifications: [],
      achievements: [],
      skills: [],
    });
    useJobsStore.setState({ jobs: [] });
  });

  it("renders nothing when closed", () => {
    const { container } = renderPalette(false);
    expect(container.querySelector("[aria-label='Quick search']")).toBeNull();
  });

  it("lists navigation actions when the query is empty", () => {
    renderPalette();
    expect(screen.getByText("Dashboard")).toBeTruthy();
    // Records need a query — the empty view shows actions only.
    expect(screen.queryByText("Payments API")).toBeNull();
  });

  it("finds vault records by title", () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "payments" },
    });
    expect(screen.getByText("Payments API")).toBeTruthy();
  });

  it("filters results by query", () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "payments" },
    });
    expect(screen.getByText("Payments API")).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
  });

  it("focuses a vault record when a record result is chosen", () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "payments" },
    });
    fireEvent.click(screen.getByText("Payments API"));
    const focus = useUiStore.getState().vaultFocus;
    expect(focus).toEqual({ key: "projects", id: 7 });
  });

  it("keyboard-navigates with ArrowDown and runs the active item on Enter", () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/search/i);
    // Flat list starts with "Dashboard"; ArrowDown moves to "Career Vault".
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    const focus = useUiStore.getState().vaultFocus;
    expect(focus).toBeNull(); // navigation actions do not set a vault focus
  });
});
