import bdkpython as bdk

print("=== BDK API CHECK ===")

print("\nWallet methods:")
print([x for x in dir(bdk.Wallet) if not x.startswith("_")])

print("\nTxBuilder methods:")
print([x for x in dir(bdk.TxBuilder) if not x.startswith("_")])

print("\nMnemonic methods:")
print([x for x in dir(bdk.Mnemonic) if not x.startswith("_")])

print("\nOutPoint methods:")
print([x for x in dir(bdk.OutPoint) if not x.startswith("_")])

print("\nFeeRate methods:")
print([x for x in dir(bdk.FeeRate) if not x.startswith("_")])

print("\nNetwork:")
print([x for x in dir(bdk.Network) if not x.startswith("_")])