# URDF Robot Inspection Criteria

This document details the evaluation criteria and scoring methodology for the URDF robot inspection system.

## Scoring System

### Score Range
- Maximum score per inspection item: **10 points**
- Overall score calculation: **Sum of all inspection item scores**

### Scoring Guidelines
Scores are assigned based on the type of issue found:

- **Error**: 0-3 points
- **Warning**: 4-6 points
- **Suggestion**: 7-9 points
- **Pass**: 10 points

### Progress Bar Color Standards
Based on normalized score (10-point scale):
- **Below 6 points**: Red
- **6-9 points**: Yellow
- **Above 9 points**: Green

---

## Inspection Categories

### 1. Physical Plausibility
**Weight**: 30%  
**Category ID**: `physical`

#### 1.1 Mass Validation
- **Item ID**: `mass_check`
- **Description**: Check that all dynamic links have mass > 0
- **Max Score**: 10 points

#### 1.2 Inertia Diagonal Elements
- **Item ID**: `inertia_diagonal`
- **Description**: Check that diagonal elements (ixx, iyy, izz) are all > 0
- **Max Score**: 10 points

#### 1.3 Inertia Triangle Inequality
- **Item ID**: `inertia_triangle`
- **Description**: Check triangle inequality: ixx + iyy > izz, ixx + izz > iyy, iyy + izz > ixx
- **Max Score**: 10 points

#### 1.4 Center of Mass
- **Item ID**: `center_of_mass`
- **Description**: Check if center of mass is reasonably positioned relative to geometry
- **Max Score**: 10 points

---

### 2. Kinematics
**Weight**: 30%  
**Category ID**: `kinematics`

#### 2.1 Zero Axis Vector
- **Item ID**: `axis_zero`
- **Description**: Check for revolute/continuous/prismatic joints with axis vector [0,0,0]
- **Max Score**: 10 points

#### 2.2 Orphan Links
- **Item ID**: `orphan_links`
- **Description**: Check for floating links not connected via joints (except root)
- **Max Score**: 10 points

#### 2.3 Joint Connectivity
- **Item ID**: `joint_connectivity`
- **Description**: Verify all joints properly connect parent and child links
- **Max Score**: 10 points

#### 2.4 Joint Limits
- **Item ID**: `joint_limits`
- **Description**: Check if joint limits are reasonable (lower < upper, reasonable ranges)
- **Max Score**: 10 points

---

### 3. Naming Conventions
**Weight**: 15%  
**Category ID**: `naming`

#### 3.1 Duplicate Names
- **Item ID**: `duplicate_names`
- **Description**: Check for duplicate user-friendly names in joints or links
- **Max Score**: 10 points

#### 3.2 Naming Consistency
- **Item ID**: `naming_consistency`
- **Description**: Check if naming follows consistent convention (snake_case vs camelCase)
- **Max Score**: 10 points

#### 3.3 Descriptive Names
- **Item ID**: `descriptive_names`
- **Description**: Check if names are descriptive and meaningful
- **Max Score**: 10 points

---

### 4. Symmetry
**Weight**: 15%  
**Category ID**: `symmetry`

#### 4.1 Left/Right Pairs
- **Item ID**: `left_right_pairs`
- **Description**: Identify and check Left/Right pairs (e.g., L_leg vs R_leg)
- **Max Score**: 10 points

#### 4.2 Symmetric Properties
- **Item ID**: `symmetry_properties`
- **Description**: Check if symmetric pairs have similar physical properties (mass, inertia, dimensions)
- **Max Score**: 10 points

---

### 5. Hardware Configuration
**Weight**: 10%  
**Category ID**: `hardware`

#### 5.1 Motor Selection
- **Item ID**: `motor_selection`
- **Description**: Check if motor types are appropriate for joint requirements
- **Max Score**: 10 points

#### 5.2 Motor Limits
- **Item ID**: `motor_limits`
- **Description**: Verify motor effort and velocity limits match joint requirements
- **Max Score**: 10 points

#### 5.3 Armature Configuration
- **Item ID**: `armature_config`
- **Description**: Check if armature values are reasonable
- **Max Score**: 10 points

---

## Inspection Process

1. **Select Items**: Users can choose which categories and specific items to inspect
2. **Execute Inspection**: The AI inspector analyzes the robot structure item by item
3. **Generate Report**: After inspection, a detailed report is generated including:
   - Overall score
   - Category scores
   - Detailed issues and suggestions for each inspection item
4. **Export Report**: Support for exporting inspection reports in PDF format

---

## Notes

- All inspection items are optional; users can select items based on their needs
- Overall score is the sum of all selected inspection item scores
- If no items are selected in a category, that category will not affect the overall score
- Inspection reports are generated in the language matching the current language setting

---

*Last Updated: 04.01.2025

