import * as zlib from 'zlib';
import type { Callback } from '../../utils';
import type { OperationDescription } from '../message_stream';

import { Snappy } from '../../deps';
import { MongoDecompressionError, MongoInvalidArgumentError } from '../../error';

/** @public */
export const Compressor = Object.freeze({
  none: 0,
  snappy: 1,
  zlib: 2
} as const);

/** @public */
export type Compressor = typeof Compressor[CompressorName];

/** @public */
export type CompressorName = keyof typeof Compressor;

export const uncompressibleCommands = new Set([
  'ismaster',
  'saslStart',
  'saslContinue',
  'getnonce',
  'authenticate',
  'createUser',
  'updateUser',
  'copydbSaslStart',
  'copydbgetnonce',
  'copydb'
]);

// Facilitate compressing a message using an agreed compressor
export function compress(
  self: { options: OperationDescription & zlib.ZlibOptions },
  dataToBeCompressed: Buffer,
  callback: Callback<Buffer>
): void {
  const zlibOptions = {} as zlib.ZlibOptions;
  switch (self.options.agreedCompressor) {
    case 'snappy':
      if ('kModuleError' in Snappy) {
        return callback(Snappy['kModuleError']);
      }
      Snappy.compress(dataToBeCompressed, callback);
      break;
    case 'zlib':
      // Determine zlibCompressionLevel
      if (self.options.zlibCompressionLevel) {
        zlibOptions.level = self.options.zlibCompressionLevel;
      }
      zlib.deflate(dataToBeCompressed, zlibOptions, callback as zlib.CompressCallback);
      break;
    default:
      throw new MongoInvalidArgumentError(
        `Unknown compressor ${self.options.agreedCompressor} failed to compress`
      );
  }
}

// Decompress a message using the given compressor
export function decompress(
  compressorID: Compressor,
  compressedData: Buffer,
  callback: Callback<Buffer>
): void {
  if (compressorID < 0 || compressorID > Math.max(2)) {
    throw new MongoDecompressionError(
      `Server sent message compressed using an unsupported compressor. (Received compressor ID ${compressorID})`
    );
  }

  switch (compressorID) {
    case Compressor.snappy:
      if ('kModuleError' in Snappy) {
        return callback(Snappy['kModuleError']);
      }
      Snappy.uncompress(compressedData, { asBuffer: true }, callback as Callback);
      break;
    case Compressor.zlib:
      zlib.inflate(compressedData, callback as zlib.CompressCallback);
      break;
    default:
      callback(undefined, compressedData);
  }
}
