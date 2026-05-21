// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { describe, expect, test, vi } from "vitest"

import { BaseListView } from "@/components/list-items/BaseListView"
import { CountProvider } from "@/contexts/CountContext"
import { HeaderSlotProvider } from "@/contexts/HeaderSlotContext"
import type { ListInstance, SortOption, ViewParams } from "@/lib/views/types"

// CountProvider calls useQuery; stub convex so it returns empty data (no provider).
vi.mock("convex/react", () => ({
  useQuery: () => ({}),
}))
// Recursive proxy so any api.* path resolves without a real generated api.
function apiProxy(): unknown {
  return new Proxy({}, { get: () => apiProxy() })
}
vi.mock("@/convex/_generated/api", () => ({ api: apiProxy() }))

type Item = { id: string; n: number }

const items: Item[] = [
  { id: "a", n: 1 },
  { id: "b", n: 3 },
  { id: "c", n: 2 },
]

const sortOptions: SortOption<Item>[] = [
  { id: "asc", label: "Ascending", compareFn: (x, y) => x.n - y.n },
  { id: "desc", label: "Descending", compareFn: (x, y) => y.n - x.n },
]

function makeList(): ListInstance<ViewParams> {
  return {
    id: "controlled-list",
    viewKey: "view:today",
    indexInView: 0,
    definition: {} as ListInstance<ViewParams>["definition"],
    params: {} as ViewParams,
    query: { type: "time", range: "today", view: "view:today" },
    collapsible: false,
    startExpanded: true,
    dependencies: {} as ListInstance<ViewParams>["dependencies"],
    getHeader: () => ({ title: "Today" }),
    getEmptyState: () => ({ title: "Nothing" }),
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <CountProvider>
      <HeaderSlotProvider>{children}</HeaderSlotProvider>
    </CountProvider>
  )
}

function renderList(props: Partial<ComponentProps<typeof BaseListView<Item>>>) {
  return render(
    <Providers>
      <BaseListView<Item>
        entities={items}
        entityType="item"
        getEntityId={(i) => i.id}
        list={makeList()}
        focusedEntityId={null}
        useEntityShortcuts={() => {}}
        sortOptions={sortOptions}
        renderRow={(item) => <div>{item.id}</div>}
        {...props}
      />
    </Providers>,
  )
}

function orderOf(testidPrefix: string): string[] {
  return screen
    .getAllByTestId(new RegExp(`^${testidPrefix}-row-\\d+$`))
    .map((el) => el.textContent ?? "")
}

describe("BaseListView controlled sort", () => {
  test("controlled sortValue drives the rendered order", () => {
    renderList({ sortValue: "asc", onSortChange: vi.fn() })
    // Ascending by n: a(1), c(2), b(3)
    expect(orderOf("item")).toEqual(["a", "c", "b"])
  })

  test("a different controlled sortValue re-orders", () => {
    renderList({ sortValue: "desc", onSortChange: vi.fn() })
    // Descending by n: b(3), c(2), a(1)
    expect(orderOf("item")).toEqual(["b", "c", "a"])
  })

  test("hideViewSettings does not break rendering (uncontrolled path)", () => {
    renderList({ hideViewSettings: true })
    // Still renders all rows; no controlled props supplied, internal default sort.
    expect(screen.getAllByTestId(/^item-row-\d+$/)).toHaveLength(3)
  })
})
