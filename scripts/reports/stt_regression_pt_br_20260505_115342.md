# STT Regression Report - PT_BR

- **Timestamp**: 2026-05-05T11:53:42.736508
- **Model**: `whisper-large-v3-turbo`
- **Dataset**: `google/fleurs`
- **Samples**: 2

## 📊 Key Metrics

| Metric | Value | benchmark (NeMo Target) |
| :--- | :--- | :--- |
| **WER** | **3.56%** | < 15% |
| **CER** | **0.79%** | < 10% |
| **Avg Latency** | 0.38s | - |
| **RTF** | 0.024 | < 0.5 |

## 🔍 Sample Analysis (Top 5 Worst WER)

| ID | Reference | Hypothesis | WER |
| :--- | :--- | :--- | :--- |
| 1 | construída pelos egípcios no século 3 a.c. a grande pirâmide é uma das muitas grandes estruturas de pirâmide construídas para honrar faraós mortos |  Construída pelos egípcios no século 3 a.C., a Grande Pirâmide é uma das muitas grandes estruturas da pirâmide construídas para honrar faraós mortos. | 4.35% |
| 0 | segundo informações ele estava na casa dos 20 anos em uma declaração bieber disse que embora eu não estivesse presente nem diretamente envolvido neste trágico incidente meus pensamentos e orações estão com a família da vítima |  Segundo informações, ele estava na casa dos 20 anos. Em uma declaração, Bieber disse que, embora eu não tivesse presente nem diretamente envolvido neste trágico incidente, meus pensamentos e orações estão com a família da vítima. | 2.78% |
