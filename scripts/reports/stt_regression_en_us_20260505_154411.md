# STT Regression Report - EN_US

- **Timestamp**: 2026-05-05T15:44:11.156503
- **Model**: `whisper-large-v3-turbo`
- **Dataset**: `google/fleurs`
- **Samples**: 10

## 📊 Key Metrics

| Metric | Value | benchmark (NeMo Target) |
| :--- | :--- | :--- |
| **WER** | **7.51%** | < 15% |
| **CER** | **2.89%** | < 10% |
| **Avg Latency** | 0.37s | - |
| **RTF** | 0.041 | < 0.5 |

## 🔍 Sample Analysis (Top 5 Worst WER)

| ID | Reference | Hypothesis | WER |
| :--- | :--- | :--- | :--- |
| 8 | the aspect ratio of this format dividing by twelve to obtain the simplest whole-number ratio is therefore said to be 3:2 |  The aspect ratio of this format, dividing by 12 to obtain the simplest whole number ratio, is therefore said to be 3 to 2. | 28.57% |
| 0 | however due to the slow communication channels styles in the west could lag behind by 25 to 30 year |  However, due to the slow communication channels, styles in the West could lag behind by 25-30 years. | 21.05% |
| 1 | all nouns alongside the word sie for you always begin with a capital letter even in the middle of a sentence |  All nouns alongside the words say for you always begin with a capital letter, even in the middle of a sentence. | 9.52% |
| 3 | the cabbage juice changes color depending on how acidic or basic alkaline the chemical is |  The cabbage juice changes color depending on how acidic, basic, alkaline the chemical is. | 6.67% |
| 7 | twentieth century research has shown that there are two pools of genetic variation hidden and expressed |  20th century research has shown that there are two pools of genetic variation hidden and expressed. | 6.25% |
