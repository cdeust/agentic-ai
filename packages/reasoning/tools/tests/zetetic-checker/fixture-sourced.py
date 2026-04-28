def decay_learning_rate(step):
    return 0.9995 ** step  # source: Smith et al. 2023, Table 3, column "cosine"
