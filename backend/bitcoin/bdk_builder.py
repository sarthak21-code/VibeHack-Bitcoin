import bdkpython as bdk

print("BDK builder module loaded")
print("Network:", bdk.Network.REGTEST)

print("Available TxBuilder methods:")
print([
    name
    for name in dir(bdk.TxBuilder)
    if not name.startswith("_")
])