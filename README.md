<div align="center">

# URDF Architect
[![React](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.181-black?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Next-Generation Visual Robot Design Platform**

**Live demo:** https://urdf.d-robotics.cc/

[English](./README.md) | [中文](./README_CN.md)

</div>

---

## 📖 Overview

**UrdfArchitect** is a state-of-the-art, web-based visual environment engineered for the seamless creation, manipulation, and export of Unified Robot Description Format (URDF) models. By abstracting the complexities of raw XML authoring into an intuitive graphical interface, it empowers roboticists to focus on design and innovation.

This platform orchestrates the entire robotic modeling lifecycle—from kinematic skeleton definition to high-fidelity geometric detailing and precise hardware specification. Enhanced by **Generative AI**, UrdfArchitect accelerates prototyping and ensures compatibility with industry-standard simulation ecosystems like MuJoCo.


## ✨ Core Capabilities

### 🦴 Advanced Design Modalities

| Mode | Functionality |
|------|-------------|
| **Skeleton** | Rapidly architect kinematic chains (Links & Joints) and define topological relationships with precision. |
| **Detail** | Fine-tune visual aesthetics and collision manifolds, supporting primitive geometries and high-resolution mesh imports (STL/OBJ/DAE). |
| **Hardware** | Specify electromechanical parameters, including actuator selection, torque constraints, and transmission ratios. |

### 🎨 Immersive 3D Workspace

- **High-Fidelity Rendering**: Powered by **Three.js** and **React Three Fiber** for a responsive, photorealistic design experience.
- **Intuitive Manipulation**: Industry-standard gizmos for precise spatial transformation of robot segments.
- **Visual Analytics**: Real-time visualization of joint axes, reference frames, and collision boundaries to ensure design integrity.

### 🤖 AI-Augmented Engineering

Leveraging **OpenAI-compatible AI models** (including DeepSeek), UrdfArchitect introduces a natural language interface for robotic design:
- *"Generate a quadrupedal locomotion platform"*
- *"Integrate a LiDAR sensor array onto the base_link"*
- *"Recommend optimal actuation for the hip joint based on torque requirements"*

### 📥 Seamless Interoperability

- **Import**: Effortlessly ingest existing projects via ZIP archives containing URDF definitions and mesh assets.
- **Export**: One-click generation of a production-ready robot package:
  - `urdf/`: Standard URDF + Extended URDF (enriched with hardware metadata).
  - `meshes/`: Consolidated directory of all referenced 3D assets.
  - `hardware/`: Automated Bill of Materials (BOM) generation in CSV format.
  - `mujoco/`: Auto-configured XML for immediate simulation in MuJoCo.

### ⚙️ Motor Library

Includes a built-in library of popular robot actuators:
- **Unitree**: Go1, A1, B1 series.
- **RobStride**: RS series.
- *Extensible*: Easily add custom motor specifications.

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **3D Engine**: Three.js, React Three Fiber, @react-three/drei
- **Build Tool**: Vite
- **AI Integration**: OpenAI SDK (supports OpenAI-compatible APIs)
- **Utilities**: JSZip, Lucide React

## 🚀 Run Locally

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/OpenLegged/URDF-Architect.git
   cd URDF-Architect
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API Key (Optional)**
   To use AI features, create a `.env.local` file in the root directory:
   ```env
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_BASE_URL=https://your-proxy-url/v1
   OPENAI_MODEL=bce/deepseek-v3.2
   ```
   
   **Configuration Details:**
   - `OPENAI_API_KEY`: Your OpenAI API key or proxy API key
   - `OPENAI_BASE_URL`: (Optional) Custom API endpoint URL. Defaults to `https://api.openai.com/v1` if not set
   - `OPENAI_MODEL`: (Optional) Model name to use. Defaults to `bce/deepseek-v3.2` if not set
   
   **Example for using a proxy server:**
   ```env
   OPENAI_API_KEY=sk-your-proxy-api-key
   OPENAI_BASE_URL=https://aiproxy.d-robotics.cc/v1
   OPENAI_MODEL=bce/deepseek-v3.2
   ```
   
   **Note:** The `.env.local` file is ignored by git and will not be committed to the repository.

4. **Run the development server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

## 📝 Usage Guide

1. **Skeleton Mode**: Use the `+` button in the tree view to add child links. Adjust joint origins using the 3D gizmos.
2. **Detail Mode**: Select a link to configure its visual and collision geometry. Upload custom meshes if needed.
3. **Hardware Mode**: Select a joint to assign motors from the library. The system automatically sets limits based on the motor specs.
4. **AI Assistant**: Click the "AI Assistant" button, type your request, and apply the generated changes.
5. **Export**: Click "Export" to download the full project ZIP.

## 📄 License

MIT License

## Acknowledgments
D-Robotics https://developer.d-robotics.cc/
