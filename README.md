# 🧠 Interactive Mindmap System

An interactive, force-directed graph visualization system built with **D3.js** and **Supabase**, enabling dynamic exploration, editing, and semantic representation of nodes and relationships.

---

## 🚀 Overview

This project visualizes data as an interactive graph (mindmap), where:

- **Nodes** represent entities
- **Links** represent relationships
- **Attributes** provide additional semantic information
- A special attribute type (`represent`) controls how nodes are visually summarized

The system supports real-time interaction, editing, and navigation across both graph and detail views.

---

## 🖱️ Node Interaction

### Hover Behavior
When hovering over a node:

- A floating **hover card** appears near the cursor
- The card displays all attributes marked as `show_on_hover`
- Each attribute includes:
  - Attribute type
  - Attribute value

If a node contains a `represent` attribute:
- It is prioritized in the visual display
- The node label is replaced with the `represent` value

Otherwise, nodes display: Label [Type]


---

## 📊 Represent Panel (Left Sidebar)

The left sidebar contains a **Represent Panel**, which:

- Lists all nodes that contain a `represent` attribute
- Displays:
  - Represent value
  - Node label and type

### Interaction
Clicking an item will:
- Focus the graph on the corresponding node
- Center it in the visualization

The panel can be toggled on/off and may be temporarily covered by other UI panels.

---

## ⚙️ Control Panel (Right Sidebar)

The right panel serves as the main control center for graph editing.

It supports:

### Node Management
- Create new nodes
- Edit node label and type
- Delete nodes

### Link Management
- Create and edit relationships
- Assign link types
- Modify descriptions

### Type Management
- Create node types
- Create link types with custom colors

This panel dynamically changes based on the selected operation.

---

## 🔗 Link Interaction

Links are fully interactive:

- Click a link → Open link editor in right panel
- Double-click a link → Navigate to **Link Detail Page**
- Hovering a link → Displays attribute-based hover card (if available)

---

## 🔍 Navigation & Interaction

The system supports multiple navigation methods:

- Drag nodes to manually adjust layout
- Force-directed simulation automatically organizes structure
- Click sidebar items to focus nodes
- Click nodes to open editing interface

The layout balances:
- Automatic graph structure
- Manual spatial control

---

## 📄 Detail Pages

### Node Detail Page
Accessible via double-click on a node.

Includes:
- Node metadata
- Attributes
- Incoming and outgoing relationships

---

### Link Detail Page
Accessible via double-click on a link.

Includes:
- Source & target nodes
- Relationship type
- Description and attributes

---

## 🧩 System Architecture

- **Frontend:** D3.js (force-directed graph visualization)
- **Backend:** Supabase (database + authentication)
- **Data Model:**
  - Nodes
  - Links
  - Node / Link Types
  - Attributes

The system dynamically synchronizes UI state with database updates.

---

## ✨ Key Features

- Interactive force-directed graph
- Attribute-driven visualization (`represent` system)
- Hover-based contextual information
- Sidebar-based navigation system
- Full CRUD support for nodes and relationships
- Dedicated detail pages for deep inspection

---

## 📌 Notes

- Designed for exploratory knowledge mapping
- Optimized for flexible schema (attributes-based extension)
- Suitable for semantic networks, research mapping, or knowledge graphs

---

The website is currently under development. After further refinement and testing of all features, it will be publicly released for graph exploration and interaction.
