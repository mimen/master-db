# View Architecture - Visual Diagrams

This document contains visual diagrams to supplement the main architecture analysis.

---

## 1. Current Architecture Overview

```mermaid
graph TB
    subgraph "User Interface"
        A[Sidebar Navigation]
        B[Top Header]
        C[Main Content Area]
        D[Command-K Palette]
    end

    subgraph "View System"
        E[View Registry]
        F[View Definitions<br/>23 patterns]
        G[List Definitions<br/>5 types]
        H[Multi-List Configs]
    end

    subgraph "Data Layer - Convex"
        I[getTimeFilterCounts]
        J[getPriorityFilterCounts]
        K[getLabelFilterCounts]
        L[getProjectsWithMetadata]
        M[getItemsByViewWithProjects]
    end

    subgraph "Count Computation"
        N[Sidebar Counts<br/>from queries]
        O[List Counts<br/>from render]
        P[Top Header Count<br/>aggregated]
    end

    A --> E
    D --> E
    E --> F
    F --> G
    F --> H

    A --> I
    A --> J
    A --> K
    A --> L

    C --> M
    M --> O

    I --> N
    J --> N
    K --> N
    L --> N

    N --> A
    O --> C
    O --> P
    P --> B

    style N fill:#ffcccc
    style O fill:#ffcccc
    style P fill:#ffcccc
```

---

## 2. View Hierarchy & Resolution

```mermaid
graph LR
    subgraph "View Types"
        A[Simple Views<br/>Inbox, Today]
        B[Dynamic Views<br/>Project, Priority]
        C[Composite Views<br/>Project Family]
        D[Multi-List Views<br/>Priority Queue]
    end

    subgraph "List Expansion"
        E[1 List]
        F[1 List<br/>parameterized]
        G[N Lists<br/>parent + children]
        H[N Lists<br/>from multiple views]
    end

    A --> E
    B --> F
    C --> G
    D --> H

    subgraph "Rendering"
        I[TaskListView × 1]
        J[TaskListView × 1]
        K[TaskListView × N]
        L[TaskListView × N]
    end

    E --> I
    F --> J
    G --> K
    H --> L
```

---

## 3. Current Count Computation Flow (Problem)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant S as Sidebar
    participant C as Convex Queries
    participant L as Layout
    participant TLV as TaskListView

    Note over U,TLV: Page Load - Sidebar Counts
    U->>S: Load application
    S->>C: getTimeFilterCounts()
    S->>C: getPriorityFilterCounts()
    S->>C: getLabelFilterCounts()
    S->>C: getProjectsWithMetadata()
    C-->>S: Return all counts
    S->>S: Display counts in badges

    Note over U,TLV: Navigation - List Counts
    U->>S: Click "Today" view
    S->>L: Navigate to view:today
    L->>L: Resolve view → lists
    L->>TLV: Render list instance
    TLV->>C: getItemsByViewWithProjects(params)
    C-->>TLV: Return task items
    TLV->>TLV: Compute visibleTasks.length
    TLV->>L: onTaskCountChange(listId, count)

    Note over U,TLV: Aggregation - Top Header Count
    L->>L: Update taskCounts Map
    L->>L: Aggregate total from Map
    L->>L: Re-render header with total

    Note over U,TLV: Problem: 4 places computing counts!
    rect rgb(255, 200, 200)
        Note right of C: 1. Convex queries
        Note right of S: 2. Sidebar displays
        Note right of TLV: 3. Lists recompute
        Note right of L: 4. Layout aggregates
    end
```

---

## 4. Count Inconsistency Example

```mermaid
graph TD
    subgraph "Scenario: Today View"
        A[Convex Query<br/>getTimeFilterCounts]
        B[Result: 10 tasks<br/>due today]
        C[Sidebar shows:<br/>Today 10]
    end

    subgraph "User Navigates to Today"
        D[Layout resolves<br/>view:today]
        E[TaskListView queries<br/>getItemsByViewWithProjects]
        F[Apply maxTasks limit<br/>limit = 5]
        G[Visible tasks:<br/>5 tasks]
        H[Top header shows:<br/>Today 5]
    end

    A --> B
    B --> C
    D --> E
    E --> F
    F --> G
    G --> H

    style C fill:#ffcccc
    style H fill:#ccffcc

    I[Inconsistency!<br/>Sidebar: 10<br/>Header: 5]

    C -.-> I
    H -.-> I

    style I fill:#ff9999
```

---

## 5. Multi-List View Problem

```mermaid
graph TD
    subgraph "Priority Queue View"
        A[view:multi:priority-queue]
        B[Sequence of 7 views]
    end

    subgraph "Component Views"
        C1[time:overdue]
        C2[today]
        C3[inbox maxTasks:10]
        C4[priority:p1]
        C5[priority-projects:p1]
        C6[priority-projects:p2]
        C7[upcoming maxTasks:15]
    end

    A --> B
    B --> C1
    B --> C2
    B --> C3
    B --> C4
    B --> C5
    B --> C6
    B --> C7

    subgraph "Count Computation"
        D[Each list queries<br/>and computes count]
        E[No pre-computed<br/>aggregate available]
        F[Sidebar has no count<br/>to display]
    end

    C1 --> D
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D
    C6 --> D
    C7 --> D

    D --> E
    E --> F

    style F fill:#ff9999

    G[Problem: Multi-list count<br/>only available after render]
    F --> G
```

---

## 6. Proposed Solution: Count Registry

```mermaid
graph TB
    subgraph "Single Data Source"
        A[Convex: getAllCounts]
        B[Combined Query<br/>~250ms vs ~380ms]
    end

    subgraph "Count Registry"
        C[Query Counts<br/>time, priority, label, project]
        D[View Counts<br/>computed from queries]
        E[List Counts<br/>updated on render]
    end

    subgraph "Consumers"
        F[Sidebar<br/>uses queryCounts]
        G[Top Header<br/>uses viewCounts]
        H[List Headers<br/>uses listCounts]
    end

    A --> B
    B --> C
    C --> D
    E --> D

    C --> F
    D --> G
    E --> H

    style C fill:#ccffcc
    style D fill:#ccffcc
    style E fill:#ccffcc

    I[Single Source of Truth]
    C --> I
    D --> I
    E --> I

    style I fill:#90EE90
```

---

## 7. Proposed Count Flow (Solution)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant S as Sidebar
    participant CR as Count Registry
    participant C as Convex
    participant L as Layout
    participant TLV as TaskListView

    Note over U,TLV: Page Load - Single Query
    U->>S: Load application
    S->>C: getAllCounts() [SINGLE QUERY]
    C-->>CR: Initialize with all counts
    CR->>S: Provide query-based counts
    S->>S: Display counts (instant)

    Note over U,TLV: Navigation - Pre-computed Count
    U->>S: Click "Today" view
    S->>L: Navigate to view:today
    L->>CR: getCountForView("view:today")
    CR-->>L: Return count (instant, no query)
    L->>L: Display in header immediately

    Note over U,TLV: Render - Update Registry
    L->>TLV: Render list instance
    TLV->>C: getItemsByViewWithProjects(params)
    C-->>TLV: Return task items
    TLV->>TLV: Compute visibleTasks.length
    TLV->>CR: updateListCount(listId, count)
    CR->>L: Notify if count changed
    L->>L: Update if needed

    Note over U,TLV: Benefits:
    rect rgb(200, 255, 200)
        Note right of C: ✅ Single query (~130ms faster)
        Note right of CR: ✅ Centralized count logic
        Note right of L: ✅ Instant count display
        Note right of S: ✅ Consistent counts everywhere
    end
```

---

## 8. Multi-List Count Resolution (Solution)

```mermaid
graph TD
    subgraph "Priority Queue View"
        A[view:multi:priority-queue]
    end

    subgraph "Count Registry"
        B[computeViewCount function]
        C[Aggregate strategy]
    end

    subgraph "Component Lists"
        L1[List 1: time:overdue<br/>count: 3]
        L2[List 2: today<br/>count: 5]
        L3[List 3: inbox<br/>count: 10]
        L4[List 4: priority:p1<br/>count: 2]
        L5[List 5: priority-projects:p1<br/>count: 7]
        L6[List 6: priority-projects:p2<br/>count: 4]
        L7[List 7: upcoming<br/>count: 15]
    end

    subgraph "Sidebar Display"
        D[Priority Queue<br/>Badge: 46]
    end

    A --> B
    B --> C

    C --> L1
    C --> L2
    C --> L3
    C --> L4
    C --> L5
    C --> L6
    C --> L7

    L1 --> D
    L2 --> D
    L3 --> D
    L4 --> D
    L5 --> D
    L6 --> D
    L7 --> D

    style D fill:#ccffcc

    E[Total: 3+5+10+2+7+4+15 = 46]
    D --> E

    style E fill:#90EE90
```

---

## 9. View Plugin System Architecture

```mermaid
graph TB
    subgraph "Core View System"
        A[View Registry]
        B[View Resolution Engine]
    end

    subgraph "Plugins"
        C[Todoist Views Plugin]
        D[Multi-List Plugin]
        E[GitHub Plugin<br/>future]
        F[Linear Plugin<br/>future]
        G[Custom User Views<br/>future]
    end

    subgraph "View Definitions"
        H[Inbox, Today, Upcoming]
        I[Priority Queue, Morning Review]
        J[GitHub Issues, PRs]
        K[Linear Issues]
        L[User-defined multi-lists]
    end

    A --> B

    C --> A
    D --> A
    E --> A
    F --> A
    G --> A

    C --> H
    D --> I
    E --> J
    F --> K
    G --> L

    subgraph "Benefits"
        M[✅ Modular extensions]
        N[✅ No core changes needed]
        O[✅ Plugin isolation]
        P[✅ Dynamic registration]
    end

    A --> M
    A --> N
    A --> O
    A --> P

    style C fill:#ccccff
    style D fill:#ccccff
    style E fill:#ffcccc
    style F fill:#ffcccc
    style G fill:#ffcccc
```

---

## 10. Enhanced View Definition Structure

```mermaid
classDiagram
    class ViewDefinition {
        +string pattern
        +ViewMetadata metadata
        +CountStrategy countStrategy
        +DisplayRules displayRules
        +CompositionRules composition
        +buildLists() ListInstance[]
    }

    class ViewMetadata {
        +string title
        +ReactNode icon
        +string description
    }

    class CountStrategy {
        +string type
        +string source
        +compute() number
    }

    class DisplayRules {
        +boolean showInSidebar
        +boolean showInCommandK
        +boolean showCountBadge
        +boolean requiresAuth
    }

    class CompositionRules {
        +string type
        +number maxLists
        +boolean collapsible
    }

    ViewDefinition --> ViewMetadata
    ViewDefinition --> CountStrategy
    ViewDefinition --> DisplayRules
    ViewDefinition --> CompositionRules

    class Example_TodayView {
        pattern: "view:today"
        countStrategy.type: "query"
        countStrategy.source: "time.today"
        displayRules.showInSidebar: true
        composition.type: "single"
    }

    class Example_PriorityQueue {
        pattern: "view:multi:priority-queue"
        countStrategy.type: "aggregate"
        displayRules.showInSidebar: true
        composition.type: "multi"
        composition.maxLists: 7
        composition.collapsible: true
    }

    ViewDefinition <|-- Example_TodayView
    ViewDefinition <|-- Example_PriorityQueue
```

---

## 11. Data Flow: User Click to Render

```mermaid
graph TD
    A[User clicks sidebar item<br/>e.g., Today] --> B[ViewKey generated<br/>view:today]

    B --> C{View Registry}

    C --> D[Pattern match]
    D --> E[Find ViewDefinition]

    E --> F{Get Count Strategy}

    F -->|type: query| G[Lookup in query counts<br/>from Count Registry]
    F -->|type: aggregate| H[Compute from list counts<br/>from Count Registry]
    F -->|type: render| I[Wait for list render]

    G --> J[Display count in header]
    H --> J
    I --> J

    E --> K[buildLists function]
    K --> L[Generate ListInstance array]

    L --> M[Layout renders lists]
    M --> N[TaskListView × N]

    N --> O[Query items from Convex]
    O --> P[Compute visible count]
    P --> Q[Update Count Registry]

    Q --> R{If count strategy<br/>is aggregate}
    R -->|Yes| S[Recompute view count]
    R -->|No| T[Already displayed]

    S --> U[Update header if changed]
    T --> U

    style G fill:#ccffcc
    style H fill:#ccffcc
    style Q fill:#ccffcc
```

---

## 12. Current vs Proposed Performance

```mermaid
gantt
    title Count Query Performance Comparison
    dateFormat X
    axisFormat %s ms

    section Current (Sequential)
    getTimeFilterCounts :0, 50
    getPriorityFilterCounts :50, 80
    getLabelFilterCounts :80, 180
    getProjectsWithMetadata :180, 380
    Total: 380ms :crit, 0, 380

    section Proposed (Single Query)
    getAllCounts (combined) :0, 250
    Total: 250ms :done, 0, 250

    section Savings
    130ms faster (34%) :active, 250, 380
```

---

## 13. Rendering Location Architecture

```mermaid
graph TB
    subgraph "Application Layout"
        A[App Container]
        B[Sidebar]
        C[Main Content]
        D[Top Header]
    end

    subgraph "Sidebar Sections"
        E[ViewsSection<br/>Inbox, Priority Queue]
        F[TimeSection<br/>Overdue, Today, Upcoming]
        G[ProjectsSection<br/>All projects]
        H[PrioritiesSection<br/>P1-P4]
        I[LabelsSection<br/>All labels]
    end

    subgraph "Count Sources"
        J[inboxProject.stats.activeCount]
        K[timeFilterCounts map]
        L[project.stats.activeCount each]
        M[priorityFilterCounts map]
        N[labelFilterCounts map]
    end

    subgraph "Main Content Rendering"
        O[Layout Component]
        P[activeView.lists array]
        Q[TaskListView × N]
        R[List Headers<br/>with counts]
    end

    A --> B
    A --> C
    A --> D

    B --> E
    B --> F
    B --> G
    B --> H
    B --> I

    J --> E
    K --> F
    L --> G
    M --> H
    N --> I

    O --> P
    P --> Q
    Q --> R

    D -.->|totalTaskCount| O
    Q -.->|onTaskCountChange| O

    style J fill:#ffffcc
    style K fill:#ffffcc
    style L fill:#ffffcc
    style M fill:#ffffcc
    style N fill:#ffffcc
```

---

## 14. Command-K Integration

```mermaid
sequenceDiagram
    participant U as User
    participant CK as Command-K
    participant VR as View Registry
    participant CR as Count Registry
    participant L as Layout

    U->>CK: Press Cmd+K
    CK->>VR: Get all navigable views
    VR-->>CK: Return view list

    loop For each view
        CK->>CR: getCountForView(viewKey)
        CR-->>CK: Return count
        CK->>CK: Format: "Today (5)"
    end

    CK->>U: Display view list with counts

    U->>CK: Select "Today"
    CK->>L: Navigate to view:today
    L->>VR: Resolve view:today
    VR-->>L: Return ViewSelection
    L->>L: Render view
```

---

## 15. Future: External Integration Architecture

```mermaid
graph TB
    subgraph "Todoist Integration"
        A1[Todoist API Client]
        A2[Todoist Views Plugin]
        A3[Todoist Count Queries]
    end

    subgraph "GitHub Integration"
        B1[GitHub API Client]
        B2[GitHub Views Plugin]
        B3[GitHub Count Queries]
    end

    subgraph "Linear Integration"
        C1[Linear API Client]
        C2[Linear Views Plugin]
        C3[Linear Count Queries]
    end

    subgraph "Core System"
        D[View Registry]
        E[Count Registry]
        F[Unified Sidebar]
        G[Unified Main Content]
    end

    A1 --> A2
    A2 --> A3
    A3 --> E

    B1 --> B2
    B2 --> B3
    B3 --> E

    C1 --> C2
    C2 --> C3
    C3 --> E

    A2 --> D
    B2 --> D
    C2 --> D

    D --> F
    D --> G
    E --> F
    E --> G

    style A1 fill:#ccccff
    style B1 fill:#ccffcc
    style C1 fill:#ffcccc

    H[Each integration:<br/>✅ Self-contained<br/>✅ No core changes<br/>✅ Unified UX]

    D --> H
    E --> H
```

---

**End of Diagrams**
