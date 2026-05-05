# STT Regression Report - PT_BR

- **Timestamp**: 2026-05-05T12:07:39.309247
- **Model**: `whisper-large-v3-turbo`
- **Dataset**: `google/fleurs`
- **Samples**: 10

## 📊 Key Metrics

| Metric | Value | benchmark (NeMo Target) |
| :--- | :--- | :--- |
| **WER** | **6.50%** | < 15% |
| **CER** | **2.67%** | < 10% |
| **Avg Latency** | 0.41s | - |
| **RTF** | 0.030 | < 0.5 |

## 🔍 Sample Analysis (Top 5 Worst WER)

| ID | Reference | Hypothesis | WER |
| :--- | :--- | :--- | :--- |
| 2 | giancarlo fisichella perdeu o controle do carro e acabou a corrida logo após a largada |  Jean Carlos fez aquela, perdeu o controle do carro e acabou a corrida logo após a largada. | 26.67% |
| 9 | consequentemente duas espécies de peixe entraram em extinção e duas outras passaram a correr risco como a espécie gila cypha |  Consequentemente, duas espécies de peixe entraram em extinção e duas outras passaram a correr risco, como a espécie gilacifa. | 10.00% |
| 5 | a parte central da meditação tibetana é o deity yoga através da visualização de várias divindades os canais de energia são limpos os chacras são ativados e a consciência da iluminação é criada |  A parte central da meditação tibetana é o Deityoga. Através da visualização de várias divindades, os canais de energia são limpos, os chakras são ativados e a consciência da iluminação é criada. | 9.09% |
| 3 | o romantismo tinha um grande elemento de determinismo cultural extraído de escritores como goethe fichte e schlegel |  O romantismo tinha um grande elemento de determinismo cultural, extraído de escritores como Goethe, Fichte e Skellige. | 5.88% |
| 1 | construída pelos egípcios no século 3 a.c. a grande pirâmide é uma das muitas grandes estruturas de pirâmide construídas para honrar faraós mortos |  Construída pelos egípcios no século 3 a.C., a Grande Pirâmide é uma das muitas grandes estruturas da pirâmide construídas para honrar faraós mortos. | 4.35% |
