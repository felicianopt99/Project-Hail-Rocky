# STT Regression Report - PT_BR

- **Timestamp**: 2026-05-05T11:51:24.425341
- **Model**: `whisper-large-v3-turbo`
- **Dataset**: `google/fleurs`
- **Samples**: 1

## 📊 Key Metrics

| Metric | Value | benchmark (NeMo Target) |
| :--- | :--- | :--- |
| **WER** | **100.00%** | < 15% |
| **CER** | **100.00%** | < 10% |
| **Avg Latency** | 0.57s | - |
| **RTF** | 0.032 | < 0.5 |

## 🔍 Sample Analysis (Top 5 Worst WER)

| ID | Reference | Hypothesis | WER |
| :--- | :--- | :--- | :--- |
| 0 | segundo informações ele estava na casa dos 20 anos em uma declaração bieber disse que embora eu não estivesse presente nem diretamente envolvido neste trágico incidente meus pensamentos e orações estão com a família da vítima |  | 100.00% |
