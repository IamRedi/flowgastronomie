const paths = {
  website: "M3 4h18v16H3zM3 8h18M6 6h.01M9 6h.01",
  translate:
    "M3 5h12M9 3v2M6 5c0 6 6 10 9 10M13 5c0 6-6 10-10 10M14 21l4-10 4 10M16 17h4",
  book: "M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1v16",
  pizza:
    "M3 20L11 3c5 1 9 5 10 10zM9 7c4 1 7 4 8 8M10 12h.01M7 16h.01M13 15h.01",
  drink: "M5 3h14l-2 18H7zM6 8h12M14 8l2-7",
  dessert: "M4 11h16v10H4zM4 15h16M8 11V8h8v3M12 8V3M11 3h2",
  salad:
    "M3 12h18c-1 6-4 9-9 9s-8-3-9-9M7 12C2 8 7 3 11 7M11 12c-1-7 6-11 8-6 3 3-1 6-4 6",
  navigation: "M4 6h16M4 12h16M4 18h16",
  language:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18",
  chevron: "M8 10l4 4 4-4",
  report: "M4 3v18h17M8 16v-4M13 16V8M18 16V5",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  logout: "M9 4H4v16h5M9 12h12M17 8l4 4-4 4",
  home: "M3 10l9-7 9 7M5 9v12h14V9M9 21v-7h6v7",
  counter: "M4 21h16M5 21v-8h14v8M7 13V3h10v10M9 6h6M9 9h3M8 17h2m4 0h2",
  orders: "M8 3H5v18l3-2 4 2 4-2 3 2V3h-3M9 3h6v4H9zM8 11h8M8 15h5",
  kitchen: "M7 14a4 4 0 0 1-2-7 5 5 0 0 1 9-2 4 4 0 1 1 3 9v6H7zM7 17h10",
  menu: "M3 5h18v15H3zM3 9h18M7 7h.01M10 7h.01M7 13h4M7 16h8",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  payment: "M3 5h18v14H3zM3 9h18M6 15h4",
  note: "M14 3H4v18h16V9zM14 3v6h6M8 13h8M8 17h5",
  ready: "M20 6L9 17l-5-5",
  pending: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  bag: "M4 7h16l1 14H3zM8 7V5a4 4 0 0 1 8 0v2",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
} as const;

export function PilotIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="pilot-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
