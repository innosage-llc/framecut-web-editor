# LDD: [Feature Name]

**FFD Link:** [Link to the parent Feature Functional Document]
**Overall Status:** `Planned` | `In Progress` | `Needs Review` | `Completed`

---

## 1. Executive Summary & Objective

[A one-paragraph summary of the technical objective of this LDD. This is copied or derived from the FFD's 'High-Level Approach' section. Example: "The objective is to refactor the data layer to support a unified view of local and remote notes by modifying the Room database schema and making the RemoteMediator 'pending-aware' to ensure data integrity and a seamless user experience."]

## 2. Phased Execution Plan Overview

[This table provides an at-a-glance summary of the entire implementation. The phases are defined here first, tailored to the specific needs of the task.]

| Phase | Title                                   | Status          | Pull Request Link |
| :---- | :-------------------------------------- | :-------------- | :---------------- |
| 1     | [Example: Data Layer: Models & DAO]     | `Planned`       | -                 |
| 2     | [Example: Domain Layer: Repositories]   | `Planned`       | -                 |
| N     | Documentation & Finalization            | `Planned`       | -                 |

---
---

## 3. Detailed Phase Breakdown

**Workflow:**
1.  **For New Features:** Fill out the `AI Engineering Brief` for each implementation phase, then complete the final "Documentation & Finalization" phase.
2.  **For Modifying Existing Code:** The AI agent is mandated to perform the **"Automated Context Acquisition Protocol"** before starting work. It will scan the target files for `@see` doc links, load them into context, and confirm the expanded scope (including updating docs) with you before proceeding.

**Template Block (for Implementation Phases):**
---

### **Phase X: [Title of Phase]**

-   **Objective:** [Describe the specific, measurable goal of this phase. 
    *Simple Example:* "Create the `NewFeatureButton` Composable as specified in the Figma design."
    *Complex Example:* "To establish the foundational database schema changes for pending notes. When this phase is complete, the app's database will support the concept of 'pending' and 'synced' notes via a new 'syncStatus' column, and the necessary Room migration will be in place and tested."]

-   **Rationale & Dependencies:** `[Optional]` [Explain why this phase is logically distinct and list any previous phases it depends on. 
    *Example:* "This phase is the foundational data layer. All subsequent data access and business logic in Phase 2 & 3 depend on these models and DAO functions being implemented correctly. It has no dependencies on other phases."]

---

#### **AI Engineering Brief (Phase X)**

-   **Context Map (Files to Modify):**
    -   `path/to/ExistingFile1.kt`
-   **Files to Create:** `[Optional]`
    -   `path/to/NewFile1.kt`

-   **Build & Environment Setup:** `[Optional]` [Specify any required build file changes, dependencies, or environment configurations.]
    -   *Example: "To support Robolectric tests in a KMP module, add the following to the `androidLibrary` block in the appropriate `build.gradle.kts`:"*
    -   *```kotlin
        // In kotlin { androidLibrary { ... } }
        withHostTestBuilder {}.configure {
            isIncludeAndroidResources = true
        }
        ```*

-   **Constants & Naming:** `[Optional]` [Define key constants, enums, or sealed classes to be used. This avoids "magic strings" and ensures consistency.]
    -   *Example:* "In `NoteEntity.kt`, add a `companion object SyncStatus` containing `const val PENDING = "PENDING"` and `const val SYNCED = "SYNCED"`. All code must use these constants, not raw strings."

-   **Workflow & Strategy:** `[Optional]` [Defines the *how*. Especially useful for refactoring.]
    -   **Strategy:** `Compiler-Driven Refactoring`
    -   **Primary Breaking Change:** [Identify the single, initial change that will cause compilation errors.]
        -   *e.g., "Add the new `syncStatus: String` and `localFilePath: String?` fields to the `NoteEntity` data class in `NoteEntity.kt`."*
    -   **Execution Steps:**
        1.  Implement the **Primary Breaking Change** and nothing else.
        2.  Attempt to compile the project. The build is expected to fail.
        3.  Parse the compilation errors to get a precise list of all files and code locations that need to be fixed.
        4.  Address each compilation error systematically using the guidance from the `Key Logic / Pseudocode` section below.
        5.  Repeat steps 2-4 until the project compiles successfully.

-   **Key Logic / Pseudocode:**
    [Provide explicit logic for *all* anticipated changes, including mappers and test factories.
    *Simple Example:*
    1.  **In `Theme.kt`:** In the `AppColors` object, change the value of `primary` to `Color(0xFF0066CC)`.

    *Complex Example:*
    1.  **For `NoteDatabase.kt`:** When fixing the migration error, implement `Migration(5, 6)`. The SQL must be: `ALTER TABLE notes ADD COLUMN syncStatus TEXT NOT NULL DEFAULT 'SYNCED'`.
    2.  **For `DtoToEntityMapper.kt`:** When fixing a constructor error, `syncStatus` must be set to `SyncStatus.SYNCED` and `localFilePath` must be `null`.
    3.  **For `TestNoteFactory.kt`:** When fixing a constructor error, provide a default value of `SyncStatus.SYNCED` for the `syncStatus` field.]

-   **Downstream Impact Analysis:** `[Optional]` [A human-generated prediction of where compilation errors will occur. This serves as a cross-check for the AI.
    *Example:* "Changing `NoteEntity` will cause compilation errors in: `NoteDatabase.kt` (migration), `NoteDao.kt`, `DtoToEntityMapper.kt`, and `TestNoteFactory.kt`."]

-   **Target Code Blocks:** `[Optional]` [Specific functions to target.
    *Example:*
    -   **File:** `composeApp/.../NoteListPage.kt`
    -   **Target:** The `onNoteClicked` lambda passed into the `NoteListScreen` composable.]

-   **Verification Criteria:**
    [Provide a checklist of success conditions. For complex tests, provide a full specification by copying the 'Test Case Specification' block below.]
    -   `[ ]` The project compiles successfully with zero warnings.
    -   `[ ]` All pre-existing, related unit tests continue to pass.
    
    ---
    **Test Case Specification X.1:** `[Optional]` `[Title of Test Case]`

    -   **Test Name:** `[e.g., test_migration_5_to_6]`
    -   **Type:** `[e.g., Instrumentation Test (androidTest)]`
    -   **Library Dependency:** `[Optional][e.g., Add 'androidTestImplementation("androidx.room:room-testing:$room_version")' to build.gradle.kts]`
    -   **Preconditions:**
        -   `[e.g., This test requires the schema JSON file for the 'from' database version, located at 'schemas/your.package.name/X.json'. The build must have Room's schema export configured.]`
    -   **Test Steps & Logic:**
        1.  `[e.g., Instantiate MigrationTestHelper for the NoteDatabase.]`
        2.  `[e.g., Create a database using helper.createDatabase(...) with the OLD schema version (5).]`
        3.  `[e.g., Use raw SQL to insert data matching the old schema via db.execSQL(...). Do NOT use a DAO.]`
        4.  `[e.g., Close the database connection.]`
        5.  `[e.g., Call helper.runMigrationsAndValidate(...) with the NEW schema version (6) and the specific migration instance.]`
    -   **Assertions:**
        -   `[e.g., Query the migrated database for the inserted note.]`
        -   `[e.g., Assert that the 'syncStatus' column of the retrieved note equals the expected default value ('SYNCED').]`
        -   `[e.g., Assert that the 'localFilePath' column is null.]`
    ---

---

#### **Execution Log (Phase X)**

-   **Status:** `Planned` | `In Progress` | `Needs Review` | `Completed`
-   **Pull Request Link:** `[Link to be added]`

-   **Execution Summary & As-Built Specification:**
    `[This section is to be filled out by the AI agent AFTER completing the work for this phase. It serves as the official record and the primary context for the next phase.]`
    -   **New Files Created:**
        -   `path/to/NewFile1.kt`
    -   **Key Modifications:**
        -   **`ExistingFile1.kt`:** Added the `newFunction()` with the following signature: `fun newFunction(param: String): Boolean`.
        -   **`ExistingFile2.kt`:** Refactored `oldFunction()` to now return a `Result<T>`.
    -   **Deviations from Plan:** `[Optional]`
        -   `[e.g., The planned `NewHelper.kt` was not needed; the logic was simple enough to be included in `ExistingFile1.kt`.]`
    -   **Key Output for Next Phase:** `[The critical information the next phase depends on.]`
        -   `[e.g., "Phase 2 should now use the newly created 'CreatePendingNoteUseCase.kt' and be aware that 'NoteEntity' has a new 'syncStatus' field."]`

-   **Founder's Review & Decision:** `[Your review notes go here AFTER the AI has filled out the above section.]`

---
---

### **Phase N: Documentation & Finalization**

-   **Objective:** To create the "institutional memory" for this feature by linking the final, as-built code back to its strategic documentation. This makes the architecture and decision-making process discoverable from the code itself.
-   **Rationale & Dependencies:** This is the final step and depends on all previous implementation phases being complete and merged.

---

#### **AI Engineering Brief (Phase N)**

-   **Context Map (Files to Modify):**
    -   `[e.g., core/data/paging/NoteRemoteMediator.kt]`
    -   `[e.g., composeApp/domain/usecase/CreatePendingNoteUseCase.kt]`

-   **Key Logic / Pseudocode:**
    1.  For each of the primary, non-trivial classes created or significantly modified in this feature, add a KDoc block at the top of the class definition.
    2.  This KDoc block must include a brief summary of the class's role.
    3.  Crucially, the KDoc block **MUST** include `@see` tags linking to both the FFD and the LDD for this feature.

    *   **Example:**
        ```kotlin
        /**
         * A brief summary of the class's role...
         *
         * For a full architectural breakdown, see the official documentation:
         * @see /docs/features/FFD-XXXX-feature-name.md
         * @see /docs/features/LDD-XXXX-feature-name.md
         */
        class MyNewClass(...) { ... }
        ```

-   **Verification Criteria:**
    -   `[ ]` The project compiles successfully.
    -   `[ ]` A Pull Request is created containing only the KDoc additions.
    -   `[ ]` Manual verification confirms that the specified files now contain the documentation links.

---

#### **Execution Log (Phase N)**

-   **Status:** `Planned` | `In Progress` | `Needs Review` | `Completed`
-   **Pull Request Link:** `[Link to be added]`
-   **Execution Summary & As-Built Specification:** `[To be filled out by the AI agent AFTER work is complete.]`
-   **Founder's Review & Decision:** `[Your review notes go here.]`
