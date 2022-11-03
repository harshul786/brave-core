/* Copyright (c) 2021 The Brave Authors. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as React from 'react'
import { useSelector } from 'react-redux'

// Constants
import {
  BraveWallet,
  SolFeeEstimates,
  TimeDelta,
  WalletAccountType,
  WalletState
} from '../../constants/types'
import {
  MAX_UINT256,
  NATIVE_ASSET_CONTRACT_ADDRESS_0X
} from '../constants/magics'
import { SwapExchangeProxy } from '../constants/registry'

// Utils
import { getLocale } from '../../../common/locale'
import Amount from '../../utils/amount'
import { getTypedSolanaTxInstructions, TypedSolanaInstructionWithParams } from '../../utils/solana-instruction-utils'
import {
  findTransactionToken,
  getETHSwapTranasactionBuyAndSellTokens,
  getLamportsMovedFromInstructions,
  getTransactionBaseValue,
  getTransactionNonce,
  getTransactionToAddress,
  getTransactionTransferedValue,
  isFilecoinTransaction,
  isSolanaDappTransaction,
  isSolanaSplTransaction,
  isSolanaTransaction
} from '../../utils/tx-utils'
import { getBalance } from '../../utils/balance-utils'
import { getAddressLabel } from '../../utils/account-utils'
import { toProperCase } from '../../utils/string-utils'
import { makeNetworkAsset } from '../../options/asset-options'
import { findTokenByContractAddress } from '../../utils/asset-utils'

// Hooks
import usePricing from './pricing'

interface ParsedTransactionFees {
  gasLimit: string
  gasPrice: string
  maxPriorityFeePerGas: string
  maxFeePerGas: string
  gasFee: string
  gasFeeFiat: string
  isEIP1559Transaction: boolean
  missingGasLimitError?: string
  gasPremium?: string
  gasFeeCap?: string
}

export interface ParsedTransaction extends ParsedTransactionFees {
  // Common fields
  hash: string
  nonce: string
  createdTime: TimeDelta
  status: BraveWallet.TransactionStatus
  sender: string
  senderLabel: string
  recipient: string
  recipientLabel: string
  fiatValue: Amount
  fiatTotal: Amount
  formattedNativeCurrencyTotal: string
  value: string
  valueExact: string
  symbol: string
  decimals: number
  insufficientFundsForGasError?: boolean
  insufficientFundsError?: boolean
  contractAddressError?: string
  sameAddressError?: string
  erc721BlockchainToken?: BraveWallet.BlockchainToken
  erc721TokenId?: string
  isSwap?: boolean
  intent: string

  // Tx type flags
  isSolanaTransaction: boolean
  isSolanaDappTransaction: boolean
  isSolanaSPLTransaction: boolean
  isFilecoinTransaction: boolean

  // Tokens
  token?: BraveWallet.BlockchainToken

  // Token approvals
  approvalTarget?: string
  approvalTargetLabel?: string
  isApprovalUnlimited?: boolean

  // Swap
  sellToken?: BraveWallet.BlockchainToken
  sellAmount?: Amount
  sellAmountWei?: Amount
  buyToken?: BraveWallet.BlockchainToken
  minBuyAmount?: Amount
  minBuyAmountWei?: Amount

  // Solana Dapp Instructions
  instructions?: TypedSolanaInstructionWithParams[]
}

export function useTransactionFeesParser (selectedNetwork?: BraveWallet.NetworkInfo, networkSpotPrice?: string, solFeeEstimates?: SolFeeEstimates) {
  /**
   * Checks if a given gasLimit is empty or zero-value, and returns an
   * appropriate localized error string.
   *
   * @remarks
   *
   * This function may only be used on ALL transaction types.
   *
   * @param gasLimit - The parsed gasLimit string.
   * @returns Localized string describing the error, or undefined in case of
   * no error.
   */
  const checkForMissingGasLimitError = React.useCallback((gasLimit: string): string | undefined => {
    return (gasLimit === '' || Amount.normalize(gasLimit) === '0')
      ? getLocale('braveWalletMissingGasLimitError')
      : undefined
  }, [])

  return React.useCallback((transactionInfo: BraveWallet.TransactionInfo): ParsedTransactionFees => {
    const { txDataUnion: { ethTxData1559: txData, filTxData } } = transactionInfo

    const isFilTransaction = filTxData !== undefined
    const isSolanaTxn = isSolanaTransaction(transactionInfo)

    const gasLimit = isFilTransaction
      ? filTxData.gasLimit
      : txData?.baseData.gasLimit || ''

    const gasPrice = txData?.baseData.gasPrice || ''
    const maxFeePerGas = txData?.maxFeePerGas || ''
    const maxPriorityFeePerGas = txData?.maxPriorityFeePerGas || ''
    const isEIP1559Transaction = maxPriorityFeePerGas !== '' && maxFeePerGas !== ''

    // [FIXME] - Extract actual fees used in the Solana transaction, instead of
    //   populating current estimates.
    const gasFee = isSolanaTxn
      ? new Amount(solFeeEstimates?.fee.toString() ?? '').format()
      : isEIP1559Transaction
        ? new Amount(maxFeePerGas)
          .times(gasLimit)
          .format()
        : new Amount(gasPrice)
          .times(gasLimit)
          .format()

    return {
      gasLimit: Amount.normalize(gasLimit),
      gasPrice: Amount.normalize(gasPrice),
      maxFeePerGas: Amount.normalize(maxFeePerGas),
      maxPriorityFeePerGas: Amount.normalize(maxPriorityFeePerGas),
      gasFee,
      gasFeeFiat: selectedNetwork && networkSpotPrice
        ? new Amount(gasFee)
          .divideByDecimals(selectedNetwork.decimals)
          .times(networkSpotPrice)
          .formatAsFiat()
        : '',
      isEIP1559Transaction,
      missingGasLimitError: isSolanaTxn
        ? undefined
        : checkForMissingGasLimitError(gasLimit),
      gasPremium: isFilTransaction ? new Amount(filTxData.gasPremium).format() : '',
      gasFeeCap: isFilTransaction ? new Amount(filTxData.gasFeeCap).format() : ''
    }
  }, [selectedNetwork, networkSpotPrice])
}

export function useTransactionParser (
  transactionNetwork?: BraveWallet.NetworkInfo
) {
  const {
    selectedNetwork: reduxSelectedNetwork,
    fullTokenList,
    userVisibleTokensInfo: visibleTokens,
    accounts,
    transactionSpotPrices: spotPrices,
    solFeeEstimates
  } = useSelector(({ wallet }: { wallet: WalletState }) => wallet)
  const selectedNetwork = transactionNetwork || reduxSelectedNetwork
  const nativeAsset = React.useMemo(
    () => selectedNetwork && makeNetworkAsset(selectedNetwork),
    [selectedNetwork]
  )
  const { findAssetPrice, computeFiatAmount } = usePricing(spotPrices)

  const networkSpotPrice = React.useMemo(
    () => selectedNetwork
      ? findAssetPrice(selectedNetwork.symbol)
      : '',
    [selectedNetwork, findAssetPrice]
  )
  const parseTransactionFees = useTransactionFeesParser(selectedNetwork, networkSpotPrice, solFeeEstimates)

  const combinedTokensList = React.useMemo(() => {
    return visibleTokens.concat(fullTokenList)
  }, [visibleTokens, fullTokenList])

  /**
   * Checks if a given address is a known contract address from our token
   * registry.
   *
   * @remarks
   *
   * This function must only be used for the following transaction types:
   *  - ERC20Transfer
   *  - ERC721TransferFrom
   *  - ERC721SafeTransferFrom
   *
   * @param to - The address to check
   * @returns Localized string describing the error, or undefined in case of
   * no error.
   */
  const checkForContractAddressError = (to: string): string | undefined => {
    return fullTokenList?.some(token => token.contractAddress.toLowerCase() === to.toLowerCase())
      ? getLocale('braveWalletContractAddressError')
      : undefined
  }

  /**
   * Checks if a given set of sender and recipient addresses are the
   * same.
   *
   * @remarks
   *
   * This function must only be used for the following transaction types:
   *  - ERC20Transfer
   *  - ERC721TransferFrom
   *  - ERC721SafeTransferFrom
   *  - ERC20Approve
   *  - ETHSend
   *
   * @param to - The recipient address
   * @param from - The sender address
   */
  const checkForSameAddressError = (to: string, from: string): string | undefined => {
    return to.toLowerCase() === from.toLowerCase()
      ? getLocale('braveWalletSameAddressError')
      : undefined
  }

  return React.useCallback((transactionInfo: BraveWallet.TransactionInfo): ParsedTransaction => {
    const {
      txArgs,
      txDataUnion: {
        solanaTxData: solTxData
      },
      fromAddress,
      txType
    } = transactionInfo

    const feeDetails = parseTransactionFees(transactionInfo)
    const { gasFeeFiat, gasFee } = feeDetails

    const isFilTransaction = isFilecoinTransaction(transactionInfo)
    const isSolanaTxn = isSolanaTransaction(transactionInfo)
    const isSPLTransaction = isSolanaSplTransaction(transactionInfo)
    const baseValue = getTransactionBaseValue(transactionInfo)
    const to = getTransactionToAddress(transactionInfo)
    const nonce = getTransactionNonce(transactionInfo)
    const account = accounts.find((account) => account.address.toLowerCase() === fromAddress.toLowerCase())
    const token = findTransactionToken(transactionInfo, combinedTokensList)
    const accountNativeBalance = getBalance(account, nativeAsset)
    const accountTokenBalance = getBalance(account, token)

    const {
      buyToken,
      sellToken,
      buyAmount,
      sellAmount,
      sellAmountWei,
      buyAmountWei
    } = getETHSwapTranasactionBuyAndSellTokens({
      nativeAsset,
      tokensList: combinedTokensList,
      tx: transactionInfo
    })

    const txBase: Pick<
      ParsedTransaction,
      | 'buyToken'
      | 'isFilecoinTransaction'
      | 'isSolanaDappTransaction'
      | 'isSolanaSPLTransaction'
      | 'isSolanaTransaction'
      | 'minBuyAmount'
      | 'minBuyAmountWei'
      | 'nonce'
      | 'recipient'
      | 'recipientLabel'
      | 'sellAmount'
      | 'sellAmountWei'
      | 'sellToken'
      | 'token'
    > = {
      buyToken,
      isFilecoinTransaction: isFilTransaction,
      isSolanaDappTransaction: isSolanaDappTransaction(transactionInfo),
      isSolanaSPLTransaction: isSPLTransaction,
      isSolanaTransaction: isSolanaTxn,
      minBuyAmount: buyAmount,
      minBuyAmountWei: buyAmountWei,
      nonce,
      recipient: to,
      recipientLabel: getAddressLabel(to, accounts),
      sellAmount,
      sellAmountWei,
      sellToken,
      token
    }

    switch (true) {
      case txBase.isSolanaDappTransaction: {
        const instructions = solTxData ? getTypedSolanaTxInstructions(solTxData) : []

        const lamportsMovedFromInstructions = getLamportsMovedFromInstructions(
          instructions,
          transactionInfo.fromAddress
        )

        const transferedValue = selectedNetwork
          ? new Amount(baseValue)
            .divideByDecimals(selectedNetwork.decimals)
            .plus(lamportsMovedFromInstructions)
            .format()
          : ''

        const transferedAmountFiat = selectedNetwork
          ? computeFiatAmount(transferedValue, selectedNetwork.symbol, selectedNetwork.decimals)
          : Amount.empty()

        const totalAmountFiat = new Amount(gasFeeFiat)
          .plus(transferedAmountFiat)

        const parsedTx: ParsedTransaction = {
          ...txBase,
          hash: transactionInfo.txHash,
          createdTime: transactionInfo.createdTime,
          status: transactionInfo.txStatus,
          sender: fromAddress,
          senderLabel: getAddressLabel(fromAddress, accounts),
          recipient: to,
          recipientLabel: getAddressLabel(to, accounts),
          fiatValue: transferedAmountFiat,
          fiatTotal: totalAmountFiat,
          formattedNativeCurrencyTotal: transferedAmountFiat
            .div(networkSpotPrice)
            .formatAsAsset(6, selectedNetwork?.symbol),
          value: selectedNetwork
            ? new Amount(transferedValue)
              .divideByDecimals(selectedNetwork.decimals)
              .format(6)
            : '',
          valueExact: selectedNetwork
            ? new Amount(transferedValue)
              .divideByDecimals(selectedNetwork.decimals)
              .format()
            : '',
          symbol: selectedNetwork?.symbol ?? '',
          decimals: selectedNetwork?.decimals ?? 18,
          insufficientFundsError: accountNativeBalance !== ''
            ? new Amount(transferedValue)
              .plus(gasFee)
              .gt(accountNativeBalance)
            : undefined,
          insufficientFundsForGasError: accountNativeBalance !== ''
            ? new Amount(gasFee).gt(accountNativeBalance)
            : undefined,
          isSwap: txType === BraveWallet.TransactionType.SolanaSwap,
          instructions,
          intent: txType === BraveWallet.TransactionType.SolanaSwap
            ? getLocale('braveWalletSwap')
            : getLocale('braveWalletTransactionIntentDappInteraction'),
          ...feeDetails
        }

        return parsedTx
      }

      // transfer(address recipient, uint256 amount) → bool
      case txType === BraveWallet.TransactionType.ERC20Transfer: {
        const [address, amount] = txArgs
        const {
          normalized: valueWrapped
        } = getTransactionTransferedValue({
          tx: transactionInfo,
          txNetwork: transactionNetwork,
          token
        })
        const price = findAssetPrice(token?.symbol ?? '')
        const sendAmountFiat = new Amount(amount)
          .divideByDecimals(token?.decimals ?? 18)
          .times(price)

        const totalAmountFiat = new Amount(gasFeeFiat)
          .plus(sendAmountFiat)

        const insufficientNativeFunds = accountNativeBalance !== ''
          ? new Amount(gasFee).gt(accountNativeBalance)
          : undefined
        const insufficientTokenFunds = accountTokenBalance !== ''
          ? new Amount(amount).gt(accountTokenBalance)
          : undefined

        return {
          ...txBase,
          hash: transactionInfo.txHash,
          createdTime: transactionInfo.createdTime,
          status: transactionInfo.txStatus,
          sender: fromAddress,
          senderLabel: getAddressLabel(fromAddress, accounts),
          fiatValue: sendAmountFiat,
          fiatTotal: totalAmountFiat,
          formattedNativeCurrencyTotal: sendAmountFiat
            .div(networkSpotPrice)
            .formatAsAsset(6, selectedNetwork?.symbol),
          value: valueWrapped.format(6),
          valueExact: valueWrapped.format(),
          symbol: token?.symbol ?? '',
          decimals: token?.decimals ?? 18,
          insufficientFundsError: insufficientTokenFunds,
          insufficientFundsForGasError: insufficientNativeFunds,
          contractAddressError: checkForContractAddressError(address),
          sameAddressError: checkForSameAddressError(address, fromAddress),
          intent: getLocale('braveWalletTransactionIntentSend')
            .replace('$1', valueWrapped.formatAsAsset(6, token?.symbol)),
          ...feeDetails
        } as ParsedTransaction
      }

      // transferFrom(address owner, address to, uint256 tokenId)
      case txType === BraveWallet.TransactionType.ERC721TransferFrom:

      // safeTransferFrom(address owner, address to, uint256 tokenId)
      case txType === BraveWallet.TransactionType.ERC721SafeTransferFrom: {
        // The owner of the ERC721 must not be confused with the
        // caller (fromAddress).
        const [owner, toAddress, tokenID] = txArgs

        const {
          normalized: valueWrapped
        } = getTransactionTransferedValue({
          tx: transactionInfo,
          txNetwork: transactionNetwork,
          token
        })

        const totalAmountFiat = gasFeeFiat

        const insufficientNativeFunds = accountNativeBalance !== ''
          ? new Amount(gasFee).gt(accountNativeBalance)
          : undefined

        const erc721TokenId = tokenID && `#${Amount.normalize(tokenID)}`

        return {
          ...txBase,
          hash: transactionInfo.txHash,
          createdTime: transactionInfo.createdTime,
          status: transactionInfo.txStatus,
          sender: fromAddress, // The caller, which may not be the owner
          senderLabel: getAddressLabel(fromAddress, accounts),
          fiatValue: Amount.zero(), // Display NFT values in the future
          fiatTotal: new Amount(totalAmountFiat),
          formattedNativeCurrencyTotal: totalAmountFiat && new Amount(totalAmountFiat)
            .div(networkSpotPrice)
            .formatAsAsset(6, selectedNetwork?.symbol),
          value: valueWrapped.format(6),
          valueExact: valueWrapped.format(),
          symbol: token?.symbol ?? '',
          decimals: 0,
          insufficientFundsForGasError: insufficientNativeFunds,
          insufficientFundsError: false,
          erc721BlockchainToken: token,
          erc721TokenId,
          contractAddressError: checkForContractAddressError(toAddress),
          sameAddressError: checkForSameAddressError(toAddress, owner),
          intent: getLocale('braveWalletTransactionIntentSend')
            .replace('$1', `${token?.symbol ?? ''} ${erc721TokenId}`),
          ...feeDetails
        } as ParsedTransaction
      }

      // approve(address spender, uint256 amount) → bool
      case txType === BraveWallet.TransactionType.ERC20Approve: {
        const [address] = txArgs

        const {
          wei: amountWrapped,
          normalized: normalizedAmount
        } = getTransactionTransferedValue({
          tx: transactionInfo,
          txNetwork: transactionNetwork,
          token
        })

        const totalAmountFiat = new Amount(gasFeeFiat)
        const insufficientNativeFunds = accountNativeBalance !== ''
          ? new Amount(gasFee).gt(accountNativeBalance)
          : undefined

        return {
          ...txBase,
          hash: transactionInfo.txHash,
          createdTime: transactionInfo.createdTime,
          status: transactionInfo.txStatus,
          sender: fromAddress,
          senderLabel: getAddressLabel(fromAddress, accounts),
          fiatValue: Amount.zero(),
          fiatTotal: totalAmountFiat,
          formattedNativeCurrencyTotal: Amount.zero()
            .formatAsAsset(2, selectedNetwork?.symbol),
          value: normalizedAmount.format(6),
          valueExact: normalizedAmount.format(),
          symbol: token?.symbol ?? '',
          decimals: token?.decimals ?? 18,
          approvalTarget: address,
          approvalTargetLabel: getAddressLabel(address, accounts),
          isApprovalUnlimited: amountWrapped.eq(MAX_UINT256),
          insufficientFundsForGasError: insufficientNativeFunds,
          insufficientFundsError: false,
          sameAddressError: checkForSameAddressError(address, fromAddress),
          intent: toProperCase(getLocale('braveWalletApprovalTransactionIntent')) + ' ' + token?.symbol ?? '',
          ...feeDetails
        } as ParsedTransaction
      }

      case txType === BraveWallet.TransactionType.SolanaSPLTokenTransfer:
      case txType === BraveWallet.TransactionType.SolanaSPLTokenTransferWithAssociatedTokenAccountCreation: {
        const price = findAssetPrice(token?.symbol ?? '')
        const sendAmountFiat = new Amount(baseValue)
          .divideByDecimals(token?.decimals ?? 9)
          .times(price)

        const totalAmountFiat = new Amount(gasFeeFiat)
          .plus(sendAmountFiat)

        const insufficientNativeFunds = accountNativeBalance !== ''
          ? new Amount(gasFee).gt(accountNativeBalance)
          : undefined
        const insufficientTokenFunds = accountTokenBalance !== ''
          ? new Amount(baseValue).gt(accountTokenBalance)
          : undefined

        const valueWrapped = new Amount(baseValue)
          .divideByDecimals(token?.decimals ?? 9)

        return {
          ...txBase,
          hash: transactionInfo.txHash,
          createdTime: transactionInfo.createdTime,
          status: transactionInfo.txStatus,
          sender: fromAddress,
          senderLabel: getAddressLabel(fromAddress, accounts),
          fiatValue: sendAmountFiat,
          fiatTotal: totalAmountFiat,
          formattedNativeCurrencyTotal: sendAmountFiat
            .div(networkSpotPrice)
            .formatAsAsset(6, selectedNetwork?.symbol),
          value: valueWrapped.format(6),
          valueExact: valueWrapped.format(),
          symbol: token?.symbol ?? '',
          decimals: token?.decimals ?? 9,
          insufficientFundsError: insufficientTokenFunds,
          insufficientFundsForGasError: insufficientNativeFunds,
          contractAddressError: checkForContractAddressError(solTxData?.toWalletAddress ?? ''),
          sameAddressError: checkForSameAddressError(solTxData?.toWalletAddress ?? '', fromAddress),
          intent: getLocale('braveWalletTransactionIntentSend')
            .replace('$1', valueWrapped.formatAsAsset(6, token?.symbol)),
          ...feeDetails
        } as ParsedTransaction
      }

      // args: (bytes fillPath, uint256 sellAmount, uint256 minBuyAmount)
      case txType === BraveWallet.TransactionType.ETHSwap: {
        const [fillPath, , minBuyAmountArg] = txArgs

        const {
          wei: sellAmountWeiBN,
          normalized: sellAmountBN
        } = getTransactionTransferedValue({
          tx: transactionInfo,
          txNetwork: transactionNetwork,
          token
        })

        const fillContracts = fillPath
          .slice(2)
          .match(/.{1,40}/g)
        const fillTokens = (fillContracts || [])
          .map(path => '0x' + path)
          .map(address =>
            address === NATIVE_ASSET_CONTRACT_ADDRESS_0X
              ? nativeAsset
              : findTokenByContractAddress(address, combinedTokensList) || nativeAsset)
          .filter(Boolean) as BraveWallet.BlockchainToken[]

        const sellToken = fillTokens.length === 1
          ? nativeAsset
          : fillTokens[0]

        const sellAmountFiat = sellToken
          ? computeFiatAmount(
              sellAmountWeiBN.format(),
              sellToken.symbol,
              sellToken.decimals
            )
          : Amount.empty()

        const buyToken = fillTokens[fillTokens.length - 1]
        const buyAmount = new Amount(minBuyAmountArg)
          .divideByDecimals(buyToken.decimals)

        const totalAmountFiat = new Amount(gasFeeFiat)
          .plus(sellAmountFiat)

        const insufficientNativeFunds = accountNativeBalance !== ''
          ? new Amount(gasFee).gt(accountNativeBalance)
          : undefined

        const sellTokenBalance = getBalance(account, sellToken)
        const insufficientTokenFunds = sellTokenBalance !== ''
          ? sellAmountWeiBN.gt(sellTokenBalance)
          : undefined

        return {
          ...txBase,
          hash: transactionInfo.txHash,
          createdTime: transactionInfo.createdTime,
          status: transactionInfo.txStatus,
          sender: fromAddress,
          senderLabel: getAddressLabel(fromAddress, accounts),
          fiatValue: sellAmountFiat,
          fiatTotal: totalAmountFiat,
          formattedNativeCurrencyTotal: sellAmountFiat
            .div(networkSpotPrice)
            .formatAsAsset(6, selectedNetwork?.symbol),
          value: sellAmountBN.format(6),
          valueExact: sellAmountBN.format(),
          symbol: sellToken?.symbol ?? '',
          decimals: sellToken?.decimals ?? 18,
          insufficientFundsError: insufficientTokenFunds,
          insufficientFundsForGasError: insufficientNativeFunds,
          isSwap: true,
          intent: getLocale('braveWalletTransactionIntentSwap')
            .replace('$1', sellAmountBN.formatAsAsset(6, sellToken?.symbol))
            .replace('$2', buyAmount.formatAsAsset(6, buyToken.symbol)),
          ...feeDetails
        } as ParsedTransaction
      }

      case to.toLowerCase() === SwapExchangeProxy:
      case txType === BraveWallet.TransactionType.ETHSend:
      case txType === BraveWallet.TransactionType.SolanaSystemTransfer:
      case txType === BraveWallet.TransactionType.Other:
      default: {
        const {
          normalized: valueWrapped
        } = getTransactionTransferedValue({
          tx: transactionInfo,
          txNetwork: transactionNetwork
        })

        const sendAmountFiat = selectedNetwork
          ? computeFiatAmount(baseValue, selectedNetwork.symbol, selectedNetwork.decimals)
          : Amount.empty()

        const totalAmountFiat = new Amount(gasFeeFiat)
          .plus(sendAmountFiat)

        return {
          ...txBase,
          hash: transactionInfo.txHash,
          createdTime: transactionInfo.createdTime,
          status: transactionInfo.txStatus,
          sender: fromAddress,
          senderLabel: getAddressLabel(fromAddress, accounts),
          fiatValue: sendAmountFiat,
          fiatTotal: totalAmountFiat,
          formattedNativeCurrencyTotal: sendAmountFiat
            .div(networkSpotPrice)
            .formatAsAsset(6, selectedNetwork?.symbol),
          value: valueWrapped.format(6),
          valueExact: valueWrapped.format(),
          symbol: selectedNetwork?.symbol ?? '',
          decimals: selectedNetwork?.decimals ?? 18,
          insufficientFundsError: accountNativeBalance !== ''
            ? new Amount(baseValue)
              .plus(gasFee)
              .gt(accountNativeBalance)
            : undefined,
          insufficientFundsForGasError: accountNativeBalance !== ''
            ? new Amount(gasFee).gt(accountNativeBalance)
            : undefined,
          isSwap: to.toLowerCase() === SwapExchangeProxy,
          intent: getLocale('braveWalletTransactionIntentSend')
            .replace('$1', valueWrapped.formatAsAsset(6, selectedNetwork?.symbol)),
          ...feeDetails
        } as ParsedTransaction
      }
    }
  }, [
    selectedNetwork,
    accounts,
    spotPrices
  ])
}

export function parseTransactionWithoutPrices ({
  accounts,
  fullTokenList,
  tx,
  transactionNetwork,
  userVisibleTokensList,
  solFeeEstimates
}: {
  accounts: WalletAccountType[]
  fullTokenList: BraveWallet.BlockchainToken[]
  solFeeEstimates?: SolFeeEstimates
  tx: BraveWallet.TransactionInfo
  transactionNetwork: BraveWallet.NetworkInfo
  userVisibleTokensList: BraveWallet.BlockchainToken[]
}): ParsedTransaction {
  const to = getTransactionToAddress(tx)
  const combinedTokensList = userVisibleTokensList.concat(fullTokenList)
  const token = findTransactionToken(tx, combinedTokensList)
  const nativeAsset = makeNetworkAsset(transactionNetwork)
  const {
    buyToken,
    sellToken,
    buyAmount,
    sellAmount,
    sellAmountWei,
    buyAmountWei
  } = getETHSwapTranasactionBuyAndSellTokens({
    nativeAsset,
    tokensList: combinedTokensList,
    tx
  })

  return {
    buyToken,
    isFilecoinTransaction: isFilecoinTransaction(tx),
    isSolanaDappTransaction: isSolanaTransaction(tx),
    isSolanaSPLTransaction: isSolanaSplTransaction(tx),
    isSolanaTransaction: isSolanaTransaction(tx),
    minBuyAmount: buyAmount,
    minBuyAmountWei: buyAmountWei,
    nonce: getTransactionNonce(tx),
    recipient: to,
    recipientLabel: getAddressLabel(to, accounts),
    sellAmount,
    sellAmountWei,
    sellToken,
    token
  } as ParsedTransaction
}
