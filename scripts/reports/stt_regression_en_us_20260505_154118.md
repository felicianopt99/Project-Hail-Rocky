# STT Regression Report - EN_US

- **Timestamp**: 2026-05-05T15:41:18.679267
- **Model**: `whisper-large-v3-turbo`
- **Dataset**: `google/fleurs`
- **Samples**: 30

## 📊 Key Metrics

| Metric | Value | benchmark (NeMo Target) |
| :--- | :--- | :--- |
| **WER** | **37.62%** | < 15% |
| **CER** | **35.23%** | < 10% |
| **Avg Latency** | 0.32s | - |
| **RTF** | 0.033 | < 0.5 |

## 🔍 Sample Analysis (Top 5 Worst WER)

| ID | Reference | Hypothesis | WER |
| :--- | :--- | :--- | :--- |
| 20 | in some areas boiling water for a minute is enough in others several minutes are needed |  | 100.00% |
| 21 | anyone who's going to drive at high latitudes or over mountain passes should consider the possibility of snow ice or freezing temperatures |  | 100.00% |
| 22 | as a result two fish species have become extinct and two others have become endangered including the humpback chub |  | 100.00% |
| 23 | it was ruled by the vichy french these were french people who had made peace with the germans in 1940 and worked with the invaders instead of fighting them |  | 100.00% |
| 24 | on 15 august 1940 the allies invaded southern france the invasion was called operation dragoon |  | 100.00% |
