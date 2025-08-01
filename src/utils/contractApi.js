import { Buffer } from 'buffer';
import base64 from 'base-64';
import {
  getContractIndex,
  encodeParams,
  decodeContractResponse,
} from './contractUtils';

export const HEADERS = {
  accept: 'application/json',
  'Content-Type': 'application/json',
};

/**
 * Creates a formatted request payload for contract interactions
 * @param {number} contractIndex - The index of the contract
 * @param {number} inputType - Function or procedure index
 * @param {number} inputSize - Size of the input data
 * @param {string} requestData - Base64 encoded input data
 * @returns {Object} Formatted request payload
 */
export const makeJsonData = (
  contractIndex,
  functionIndex,
  inputSize,
  requestData
) => ({
  contractIndex,
  inputType: functionIndex,
  inputSize,
  requestData,
});

/**
 * Execute a view function (query) on a contract
 * @param {string} httpEndpoint - API endpoint URL
 * @param {number|string} contractIndex - Contract index or name
 * @param {number} functionIndex - Function index
 * @param {Object} params - Function parameters
 * @param {Array} inputFields - Input field definitions
 * @param {Object} selectedFunction - Complete function definition
 * @param {Object} customIndexes - Custom indexes for contract
 * @param {Object} qHelper - QubicHelper instance for encoding IDs
 * @returns {Promise<Object>} Query result
 */
export async function queryContract(
  httpEndpoint,
  contractIndex,
  functionIndex,
  params = {},
  inputFields = [],
  selectedFunction = null,
  customIndexes = null,
  qHelper = null
) {
  console.log(
    `Query contract called with: ${contractIndex}, function: ${functionIndex}`
  );

  let contractIdxNum = contractIndex;

  if (typeof contractIndex === 'string') {
    contractIdxNum = 15; // QDRAW hardcoded- getContractIndex(contractIndex, customIndexes);
  }

  const encodedData = encodeParams(params, inputFields, qHelper);
  const inputSize = encodedData
    ? Buffer.from(base64.decode(encodedData), 'binary').length
    : 0;
  const queryData = makeJsonData(
    contractIdxNum,
    functionIndex,
    inputSize,
    encodedData
  );

  try {
    let endpoint = httpEndpoint;
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = 'https://' + endpoint;
    }

    let url = `${endpoint}/v1/querySmartContract`;
    if (
      process.env.NODE_ENV === 'development' &&
      endpoint.includes('rpc.qubic.org')
    ) {
      // Only use proxy for mainnet endpoint to avoid CORS
      url = `/api/proxy/v1/querySmartContract`;
    }

    console.log('[contractApi] Making request to URL:', url);
    console.log(
      '[contractApi] Request payload:',
      JSON.stringify(queryData, null, 2)
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(queryData),
    });

    console.log('[contractApi] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
    }

    const json = await response.json();
    console.log(
      '[contractApi] Raw JSON response:',
      JSON.stringify(json, null, 2)
    );

    // Check if responseData exists and log its details
    if (json.responseData) {
      console.log(
        '[contractApi] ResponseData exists, length:',
        json.responseData.length
      );
      console.log(
        '[contractApi] ResponseData preview:',
        json.responseData.substring(0, 100)
      );
    } else {
      console.log('[contractApi] ResponseData is missing or empty!');
      console.log('[contractApi] Full response keys:', Object.keys(json));

      // If proxy returns empty data, try direct call as fallback
      if (
        process.env.NODE_ENV === 'development' &&
        endpoint.includes('rpc.qubic.org')
      ) {
        console.log(
          '[contractApi] Proxy returned empty data, trying direct call...'
        );

        const directUrl = `${endpoint}/v1/querySmartContract`;
        console.log('[contractApi] Trying direct URL:', directUrl);

        try {
          const directResponse = await fetch(directUrl, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(queryData),
          });

          if (directResponse.ok) {
            const directJson = await directResponse.json();
            console.log(
              '[contractApi] Direct call response:',
              JSON.stringify(directJson, null, 2)
            );

            if (directJson.responseData) {
              console.log(
                '[contractApi] Direct call has responseData! Using it.'
              );
              return {
                ...decodeContractResponse(
                  directJson.responseData,
                  selectedFunction?.outputs || []
                ),
                rawResponse: directJson,
              };
            }
          }
        } catch (directError) {
          console.log(
            '[contractApi] Direct call also failed:',
            directError.message
          );
        }
      }
    }

    const decodedResponse = decodeContractResponse(
      json.responseData,
      selectedFunction?.outputs || []
    );

    console.log('[contractApi] Decoded response:', decodedResponse);

    return {
      ...decodedResponse,
      rawResponse: json,
    };
  } catch (error) {
    console.error('Error querying contract:', error);
    let errorDetails = error.message;

    if (error.message.includes('Failed to fetch')) {
      errorDetails = `Network error: Unable to reach ${httpEndpoint}. This could be due to CORS restrictions, network connectivity, or the server being unavailable. Try using a CORS proxy or backend API.`;
    }

    return {
      success: false,
      error: errorDetails,
    };
  }
}

/**
 * Parse binary response data and provide human-readable output
 * @param {Buffer} bytes - The binary response data
 * @param {string|number} contractIndex - The contract index
 * @param {number} functionIndex - The function index
 * @param {Object} selectedFunction - The function definition
 * @returns {Object} Human-readable interpretation of the data
 */
function parseBinaryResponse(
  bytes,
  contractIndex,
  functionIndex,
  selectedFunction
) {
  const dv = new DataView(bytes.buffer);

  // Step 1: Create a basic result object
  const result = {
    formatted: {}, // This will hold our human-readable values
    rawHex: [...new Uint8Array(bytes.buffer)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' '),
    byteLength: bytes.length,
  };

  // Step 2: Parse based on function output definition if available
  if (
    selectedFunction &&
    selectedFunction.outputs &&
    selectedFunction.outputs.length > 0
  ) {
    // We have output field definitions, use them for parsing
    let offset = 0;
    selectedFunction.outputs.forEach((field) => {
      let value;

      // Parse based on field type
      if (field.type.includes('int64') || field.type.includes('uint64')) {
        if (offset + 8 <= bytes.length) {
          try {
            value = field.type.includes('uint')
              ? dv.getBigUint64(offset, true).toString()
              : dv.getBigInt64(offset, true).toString();
          } catch (e) {
            // Fallback for browsers without BigInt
            const low = dv.getUint32(offset, true);
            const high = dv.getUint32(offset + 4, true);
            value = low + high * Math.pow(2, 32);
          }
          offset += 8;
        }
      } else if (
        field.type.includes('int32') ||
        field.type.includes('uint32')
      ) {
        if (offset + 4 <= bytes.length) {
          value = field.type.includes('uint')
            ? dv.getUint32(offset, true)
            : dv.getInt32(offset, true);
          offset += 4;
        }
      } else if (field.type === 'bit' || field.type === 'bool') {
        if (offset + 1 <= bytes.length) {
          value = dv.getUint8(offset) !== 0;
          offset += 1;
        }
      } else {
        // For unknown types, provide a note
        value = `[Binary data at offset ${offset}, type: ${field.type}]`;
      }

      result.formatted[field.name] = value;
    });

    return result;
  }

  // Step 3: If no field definitions, use heuristics to parse the data

  // For single values (common case)
  if (bytes.length === 4) {
    result.formatted.value = dv.getInt32(0, true);
    result.formatted.valueType = 'int32';
    return result;
  }

  if (bytes.length === 8) {
    try {
      const int64Val = dv.getBigInt64(0, true).toString();
      const uint64Val = dv.getBigUint64(0, true).toString();
      result.formatted.value = int64Val;
      result.formatted.unsignedValue = uint64Val;
      result.formatted.valueType = 'int64';
    } catch (e) {
      // Fallback
      const low = dv.getUint32(0, true);
      const high = dv.getUint32(4, true);
      result.formatted.value = low + high * Math.pow(2, 32);
      result.formatted.valueType = 'int64 (approximated)';
    }
    return result;
  }

  // For multiple 64-bit values (common in smart contracts)
  if (bytes.length % 8 === 0 && bytes.length > 0) {
    const numValues = bytes.length / 8;
    for (let i = 0; i < numValues; i++) {
      try {
        const fieldName = `value${i + 1}`;
        result.formatted[fieldName] = dv.getBigUint64(i * 8, true).toString();
      } catch (e) {
        // Fallback
        const low = dv.getUint32(i * 8, true);
        const high = dv.getUint32(i * 8 + 4, true);
        result.formatted[`value${i + 1}`] = low + high * Math.pow(2, 32);
      }
    }
    return result;
  }

  // For known patterns in specific contracts (hardcoded examples, expand as needed)
  if (contractIndex === 9 && functionIndex === 1 && bytes.length === 40) {
    // Qearn.getStatsPerEpoch
    result.formatted = {
      earlyUnlockedAmount: dv.getBigUint64(0, true).toString(),
      earlyUnlockedPercent: dv.getBigUint64(8, true).toString(),
      totalLockedAmount: dv.getBigUint64(16, true).toString(),
      averageAPY: dv.getBigUint64(24, true).toString(),
      additionalValue: dv.getBigUint64(32, true).toString(),
    };
    return result;
  }

  // If none of the above, give a generic representation
  result.formatted.note =
    'Could not identify a specific output format for this function';
  result.formatted.hexRepresentation = result.rawHex;

  return result;
}

/**
 * Execute a transaction (procedure) on a contract
 * @param {string} httpEndpoint - API endpoint URL
 * @param {number} contractIndex - Contract index
 * @param {number} procedureIndex - Procedure index
 * @param {Object} params - Procedure parameters
 * @returns {Promise<Object>} Transaction result
 */
export async function executeTransaction(
  httpEndpoint,
  contractIndex,
  procedureIndex,
  params = {}
) {
  // Convert params to appropriate binary format and encode as base64
  const encodedData = encodeParams(params);
  const inputSize = encodedData
    ? Buffer.from(base64.decode(encodedData), 'binary').length
    : 0;

  const txData = makeJsonData(
    contractIndex,
    procedureIndex,
    inputSize,
    encodedData
  );

  try {
    console.log('Sending transaction data:', txData);

    // If endpoint doesn't have http/https prefix, add it
    let endpoint = httpEndpoint;
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = 'https://' + endpoint;
    }

    // Check if we should use a proxy to avoid CORS issues
    let url = `${endpoint}/v1/submitTransaction`;
    let corsOptions = {};

    // If we're in development, use the local proxy to avoid CORS issues
    if (
      process.env.NODE_ENV === 'development' &&
      endpoint.includes('rpc.qubic.org')
    ) {
      // Only use proxy for mainnet endpoint to avoid CORS
      url = `/api/proxy/v1/submitTransaction`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(txData),
      ...corsOptions,
    });

    if (!response.ok) {
      throw new Error(
        `HTTP error! status: ${response.status} - ${await response.text()}`
      );
    }

    const json = await response.json();
    console.log('Transaction response:', json);

    return {
      success: true,
      txHash: json.txHash,
      ...json,
    };
  } catch (error) {
    console.error('Error executing transaction:', error);

    // Provide more info about the error
    let errorDetails = error.message;

    // Check for common network errors
    if (error.message.includes('Failed to fetch')) {
      errorDetails = `Network error: Unable to reach ${httpEndpoint}. This could be due to CORS restrictions, network connectivity, or the server being unavailable. Try using a CORS proxy or backend API.`;
    }

    return {
      success: false,
      error: errorDetails,
    };
  }
}

// Identify potential fee-related functions by name patterns
function findFeeFunctions(contractFunctions) {
  const feePatterns = [
    /fee/i,
    /minimum/i,
    /min.*deposit/i,
    /deposit.*min/i,
    /limit/i,
    /threshold/i,
    /required/i,
  ];

  return contractFunctions.filter((fn) => {
    // Only look at view functions (type === 'view')
    if (fn.type !== 'view') return false;

    // Check if function name matches any fee-related patterns
    return feePatterns.some((pattern) => pattern.test(fn.name));
  });
}

// Function to parse constants from contract code
export function parseContractConstants(contractContent) {
  const constants = {};

  // Match constexpr declarations like:
  // constexpr uint64 QEARN_MINIMUM_LOCKING_AMOUNT = 10000000;
  const constRegex =
    /constexpr\s+(?:uint|sint|int)\d*\s+([A-Z0-9_]+)\s*=\s*(\d+)(?:ULL)?;/g;
  let match;

  while ((match = constRegex.exec(contractContent)) !== null) {
    const constName = match[1];
    const constValue = parseInt(match[2], 10);
    constants[constName] = constValue;
  }

  // Also look for initialize sections that set important values
  // INITIALIZE
  //   state.setProposalFee = 1000000;
  // _
  const initRegex = /INITIALIZE[^_]*state\.([A-Za-z0-9_]+)\s*=\s*(\d+);/g;

  while ((match = initRegex.exec(contractContent)) !== null) {
    const stateName = match[1];
    const stateValue = parseInt(match[2], 10);
    constants[stateName] = stateValue;
  }

  // Map common constant names to meaningful labels
  const commonConstantMappings = {
    QEARN_MINIMUM_LOCKING_AMOUNT: 'minimumLockingAmount',
    setProposalFee: 'proposalFee',
  };

  // Create a cleaned up, normalized object
  const normalizedConstants = {};

  Object.entries(constants).forEach(([key, value]) => {
    // Use common mapping if available, otherwise use the original key
    const normalizedKey = commonConstantMappings[key] || key;
    normalizedConstants[normalizedKey] = value;
  });

  return normalizedConstants;
}

// Extract procedure requirements based on code analysis
export function extractProcedureRequirements(contractContent, procedureName) {
  const requirements = {};

  // Find the procedure definition
  const procRegex = new RegExp(
    `PUBLIC_PROCEDURE(?:_WITH_LOCALS)?\\s*\\(${procedureName}\\)[^_]*`,
    's'
  );
  const procMatch = procRegex.exec(contractContent);

  if (procMatch) {
    const procCode = procMatch[0];

    // Look for minimum amount checks
    const minAmountRegex = /qpi\.invocationReward\(\)\s*<\s*([A-Z0-9_]+|\d+)/g;
    const minAmountMatch = minAmountRegex.exec(procCode);

    if (minAmountMatch) {
      const minAmountVar = minAmountMatch[1];
      // If it's a constant reference, look up the value
      if (/^[A-Z0-9_]+$/.test(minAmountVar)) {
        const constRegex = new RegExp(
          `constexpr\\s+(?:uint|sint|int)\\d*\\s+${minAmountVar}\\s*=\\s*(\\d+)(?:ULL)?;`
        );
        const constMatch = constRegex.exec(contractContent);
        if (constMatch) {
          requirements.minimumAmount = parseInt(constMatch[1], 10);
        }
      } else {
        // Direct numeric value
        requirements.minimumAmount = parseInt(minAmountVar, 10);
      }
    }

    // Look for fee checks
    const feeRegex = /qpi\.invocationReward\(\)\s*<\s*state\.([A-Za-z0-9_]+)/g;
    const feeMatch = feeRegex.exec(procCode);

    if (feeMatch) {
      const feeVar = feeMatch[1];
      // Find the initialization of this state variable
      const initRegex = new RegExp(`state\\.${feeVar}\\s*=\\s*(\\d+)`, 'g');
      const initMatch = initRegex.exec(contractContent);
      if (initMatch) {
        requirements.fee = parseInt(initMatch[1], 10);
      }
    }
  }

  return requirements;
}

// Enhanced discovery function that analyzes contract code
export async function discoverContractFees(httpEndpoint, contract) {
  if (!contract || !contract.functions) return null;

  const contractName = contract.contractName || contract.fileName.split('.')[0];
  const feeResults = {};

  // Parse constants from contract content
  const constants = parseContractConstants(contract.content);

  // Add constants to results
  Object.entries(constants).forEach(([key, value]) => {
    feeResults[key] = {
      functionName: key,
      data: { [key]: value },
      source: 'parsed_constant',
    };
  });

  // Extract procedure requirements
  const procedureConstants = {};
  contract.functions.forEach((fn) => {
    if (fn.type === 'transaction') {
      const requirements = extractProcedureRequirements(
        contract.content,
        fn.name
      );
      if (Object.keys(requirements).length > 0) {
        procedureConstants[fn.name] = requirements;
      }
    }
  });

  // Query fee-related functions
  const feeFunctions = findFeeFunctions(contract.functions);

  for (const fn of feeFunctions) {
    try {
      const result = await queryContract(
        httpEndpoint,
        contractName,
        fn.index,
        {},
        fn.inputs || [],
        fn
      );

      if (result.success) {
        feeResults[fn.name] = {
          functionName: fn.name,
          data: result.decodedFields,
          source: 'api',
          raw: result,
        };
      }
    } catch (error) {
      console.error(`Error querying fee function ${fn.name}:`, error);
    }
  }

  return {
    contractName: contractName,
    feeInfo: feeResults,
    timestamp: Date.now(),
    procedureConstants: procedureConstants,
  };
}

// Check if a transaction might need fees based on naming conventions
export function mightRequireFee(functionName) {
  const feeRequiringPatterns = [
    /set/i,
    /create/i,
    /add/i,
    /deposit/i,
    /lock/i,
    /stake/i,
    /vote/i,
    /propose/i,
    /proposal/i,
    /submit/i,
  ];

  return feeRequiringPatterns.some((pattern) => pattern.test(functionName));
}
