import { PasskeyArgType, PasskeyClient, SigningMethod } from '@safe-global/protocol-kit'

import { Address, encodeFunctionData, getContract, http, parseAbiItem, createPublicClient } from 'viem'
import {
  BUNDLER_URL,
  NFT_ADDRESS,
  PAYMASTER_URL,
  RPC_URL
} from './constants'
import { PASSKEY_FACTORY, PASSKEY_FACTORY_ABI } from './abi'
import { baseSepolia } from 'viem/chains'
import { Safe4337Pack, SponsoredPaymasterOption } from '@safe-global/relay-kit'
import SafeApiKit  from '@safe-global/api-kit'
const VERIFIER_ADDRESS = '0x445a0683e494ea0c5AF3E83c5159fBE47Cf9e765' as Address
const SENTINEL_ADDRESS = '0x0000000000000000000000000000000000000001' as Address
const SHARED_WEBAUTHN = '0x94a4F6affBd8975951142c3999aEAB7ecee555c2' as Address

const apiKit = new SafeApiKit({
  chainId: BigInt(baseSepolia.id),
})


const paymasterOptions = {
  isSponsored: true,
  paymasterUrl: PAYMASTER_URL
} as SponsoredPaymasterOption

/**
 * Mint an NFT.
 * @param {PasskeyArgType} signer - Signer object with rawId and coordinates.
 * @returns {Promise<void>}
 * @throws {Error} If the operation fails.
 */
export const mintNFT = async (
  passkey: PasskeyArgType,
  isSafeDeployed: boolean,
  address: Address
): Promise<string> => {
  const passkeyContract = getContract({
    address: PASSKEY_FACTORY.networkAddresses[84532],
    abi: PASSKEY_FACTORY_ABI,
    client: createPublicClient({
      chain: baseSepolia,
      transport: http()
    })
  })
  const signerAddress = await passkeyContract.read.getSigner([BigInt(passkey.coordinates.x), BigInt(passkey.coordinates.y), BigInt(VERIFIER_ADDRESS)])
  console.log('Signer from passkey', signerAddress)
  const options = isSafeDeployed ? { safeAddress: address } : { owners: [], threshold: 1 }
  const safe4337Pack = await Safe4337Pack.init({
    provider: RPC_URL,
    signer: passkey,
    bundlerUrl: BUNDLER_URL,
    paymasterOptions,
    options
  })
  const safeAddress = await safe4337Pack.protocolKit.getAddress()
  const txs = []

  console.log('IsSafeDeployed', isSafeDeployed)
  if (!isSafeDeployed) {
    const safeProvider = safe4337Pack.protocolKit.getSafeProvider()
    const signer = await safeProvider.getExternalSigner() as any as PasskeyClient
    console.log(signer)
    const createSignerTx = {
      to: PASSKEY_FACTORY.networkAddresses[84532],
      data: encodeFunctionData({
        abi: PASSKEY_FACTORY_ABI,
        functionName: 'createSigner',
        args: [BigInt(passkey.coordinates.x), BigInt(passkey.coordinates.y), BigInt(VERIFIER_ADDRESS)]
      }),
      value: '0'
    }
    const swapOwnerTx = {
      to: safeAddress,
      data: encodeFunctionData({
        abi: [parseAbiItem('function swapOwner(address prevOwner, address oldOwner, address newOwner)')],
        functionName: 'swapOwner',
        args: [SENTINEL_ADDRESS, SHARED_WEBAUTHN, signerAddress]
      }),
      value: '0'

    }
    txs.push(createSignerTx)
    txs.push(swapOwnerTx)
  }

  const mintTx = {
    to: NFT_ADDRESS,
    data: encodeSafeMintData(safeAddress),
    value: '0'
  }
  txs.push(mintTx)
  const safeOperation = await safe4337Pack.createTransaction({
    transactions: txs
  })

  const signedSafeOperation =
    await safe4337Pack.signSafeOperation(safeOperation)


  const userOperationHash = await safe4337Pack.executeTransaction({
    executable: signedSafeOperation
  })

  return userOperationHash
}

export const signMessage = async (passkey: PasskeyArgType,
  isSafeDeployed: boolean,
  address: Address,
  message: string): Promise<string> => {
  const passkeyContract = getContract({
    address: PASSKEY_FACTORY.networkAddresses[84532],
    abi: PASSKEY_FACTORY_ABI,
    client: createPublicClient({
      chain: baseSepolia,
      transport: http()
    })
  })
  const signerAddress = await passkeyContract.read.getSigner([BigInt(passkey.coordinates.x), BigInt(passkey.coordinates.y), BigInt(VERIFIER_ADDRESS)])
  const options = { safeAddress: address }
  const safe4337Pack = await Safe4337Pack.init({
    provider: RPC_URL,
    signer: passkey,
    bundlerUrl: BUNDLER_URL,
    paymasterOptions,
    options
  })
  const safeAddress = await safe4337Pack.protocolKit.getAddress()
  const messageToSign = await safe4337Pack.protocolKit.createMessage(message)
  const signature = await safe4337Pack.protocolKit.signMessage(messageToSign, SigningMethod.SAFE_SIGNATURE, '0xaDdA20B6365EBCECC99CA03B778FdBA218438C6B')
  console.log('signature', signature.getSignature(signerAddress)?.dynamicPart())
  console.log('messageToSign', messageToSign.data)
  const messageProps = {
    message: message,
    signature: signature.encodedSignatures()
  }
  try {
    console.log('safeAddress', safeAddress)
    await apiKit.addMessage(safeAddress, messageProps)
  } catch (error) {
    console.log('error', error)
  }
  return 'done'
}

/**
 * Encodes the data for a safe mint operation.
 * @param to The address to mint the token to.
 * @param tokenId The ID of the token to mint.
 * @returns The encoded data for the safe mint operation.
 */
export function encodeSafeMintData(
  to: string,
  tokenId: bigint = getRandomUint256()
): string {
  return encodeFunctionData({
    abi: [
      {
        constant: false,
        inputs: [
          {
            name: 'to',
            type: 'address'
          },
          {
            name: 'tokenId',
            type: 'uint256'
          }
        ],
        name: 'safeMint',
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function'
      }
    ],
    functionName: 'safeMint',
    args: [to, tokenId]
  })
}

/**
 * Generates a random 256-bit unsigned integer.
 *
 * @returns {bigint} A random 256-bit unsigned integer.
 *
 * This function uses the Web Crypto API's `crypto.getRandomValues()` method to generate
 * a uniformly distributed random value within the range of 256-bit unsigned integers
 * (from 0 to 2^256 - 1).
 */
function getRandomUint256(): bigint {
  const dest = new Uint8Array(32) // Create a typed array capable of storing 32 bytes or 256 bits

  crypto.getRandomValues(dest) // Fill the typed array with cryptographically secure random values

  let result = 0n
  for (let i = 0; i < dest.length; i++) {
    result |= BigInt(dest[i]) << BigInt(8 * i) // Combine individual bytes into one bigint
  }

  return result
}
