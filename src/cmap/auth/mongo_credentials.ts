// Resolves the default auth mechanism according to

import type { Document } from '../../bson';
import { MongoDriverError, MongoMissingCredentialsError } from '../../error';
import { AuthMechanism } from './defaultAuthProviders';

// https://github.com/mongodb/specifications/blob/master/source/auth/auth.rst
function getDefaultAuthMechanism(ismaster?: Document): AuthMechanism {
  if (ismaster) {
    // If ismaster contains saslSupportedMechs, use scram-sha-256
    // if it is available, else scram-sha-1
    if (Array.isArray(ismaster.saslSupportedMechs)) {
      return ismaster.saslSupportedMechs.includes(AuthMechanism.MONGODB_SCRAM_SHA256)
        ? AuthMechanism.MONGODB_SCRAM_SHA256
        : AuthMechanism.MONGODB_SCRAM_SHA1;
    }

    // Fallback to legacy selection method. If wire version >= 3, use scram-sha-1
    if (ismaster.maxWireVersion >= 3) {
      return AuthMechanism.MONGODB_SCRAM_SHA1;
    }
  }

  // Default for wireprotocol < 3
  return AuthMechanism.MONGODB_CR;
}

/** @public */
export interface MongoCredentialsOptions {
  username: string;
  password: string;
  source: string;
  db?: string;
  mechanism?: AuthMechanism;
  mechanismProperties: Document;
}

/**
 * A representation of the credentials used by MongoDB
 * @public
 */
export class MongoCredentials {
  /** The username used for authentication */
  readonly username: string;
  /** The password used for authentication */
  readonly password: string;
  /** The database that the user should authenticate against */
  readonly source: string;
  /** The method used to authenticate */
  readonly mechanism: AuthMechanism;
  /** Special properties used by some types of auth mechanisms */
  readonly mechanismProperties: Document;

  constructor(options: MongoCredentialsOptions) {
    this.username = options.username;
    this.password = options.password;
    this.source = options.source;
    if (!this.source && options.db) {
      this.source = options.db;
    }
    this.mechanism = options.mechanism || AuthMechanism.MONGODB_DEFAULT;
    this.mechanismProperties = options.mechanismProperties || {};

    if (this.mechanism.match(/MONGODB-AWS/i)) {
      if (!this.username && process.env.AWS_ACCESS_KEY_ID) {
        this.username = process.env.AWS_ACCESS_KEY_ID;
      }

      if (!this.password && process.env.AWS_SECRET_ACCESS_KEY) {
        this.password = process.env.AWS_SECRET_ACCESS_KEY;
      }

      if (!this.mechanismProperties.AWS_SESSION_TOKEN && process.env.AWS_SESSION_TOKEN) {
        this.mechanismProperties = {
          ...this.mechanismProperties,
          AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN
        };
      }
    }

    Object.freeze(this.mechanismProperties);
    Object.freeze(this);
  }

  /** Determines if two MongoCredentials objects are equivalent */
  equals(other: MongoCredentials): boolean {
    return (
      this.mechanism === other.mechanism &&
      this.username === other.username &&
      this.password === other.password &&
      this.source === other.source
    );
  }

  /**
   * If the authentication mechanism is set to "default", resolves the authMechanism
   * based on the server version and server supported sasl mechanisms.
   *
   * @param ismaster - An ismaster response from the server
   */
  resolveAuthMechanism(ismaster?: Document): MongoCredentials {
    // If the mechanism is not "default", then it does not need to be resolved
    if (this.mechanism.match(/DEFAULT/i)) {
      return new MongoCredentials({
        username: this.username,
        password: this.password,
        source: this.source,
        mechanism: getDefaultAuthMechanism(ismaster),
        mechanismProperties: this.mechanismProperties
      });
    }

    return this;
  }

  validate(): void {
    if (
      (this.mechanism === AuthMechanism.MONGODB_GSSAPI ||
        this.mechanism === AuthMechanism.MONGODB_CR ||
        this.mechanism === AuthMechanism.MONGODB_PLAIN ||
        this.mechanism === AuthMechanism.MONGODB_SCRAM_SHA1 ||
        this.mechanism === AuthMechanism.MONGODB_SCRAM_SHA256) &&
      !this.username
    ) {
      throw new MongoMissingCredentialsError(`Username required for mechanism '${this.mechanism}'`);
    }

    if (
      this.mechanism === AuthMechanism.MONGODB_GSSAPI ||
      this.mechanism === AuthMechanism.MONGODB_AWS ||
      this.mechanism === AuthMechanism.MONGODB_X509
    ) {
      if (this.source != null && this.source !== '$external') {
        // TODO(NODE-3483): Replace this with a MongoAuthValidationError
        throw new MongoDriverError(
          `Invalid source '${this.source}' for mechanism '${this.mechanism}' specified.`
        );
      }
    }

    if (this.mechanism === AuthMechanism.MONGODB_PLAIN && this.source == null) {
      // TODO(NODE-3483): Replace this with a MongoAuthValidationError
      throw new MongoDriverError('PLAIN Authentication Mechanism needs an auth source');
    }

    if (this.mechanism === AuthMechanism.MONGODB_X509 && this.password != null) {
      if (this.password === '') {
        Reflect.set(this, 'password', undefined);
        return;
      }
      // TODO(NODE-3483): Replace this with a MongoAuthValidationError
      throw new MongoDriverError(`Password not allowed for mechanism MONGODB-X509`);
    }
  }

  static merge(
    creds: MongoCredentials | undefined,
    options: Partial<MongoCredentialsOptions>
  ): MongoCredentials {
    return new MongoCredentials({
      username: options.username ?? creds?.username ?? '',
      password: options.password ?? creds?.password ?? '',
      mechanism: options.mechanism ?? creds?.mechanism ?? AuthMechanism.MONGODB_DEFAULT,
      mechanismProperties: options.mechanismProperties ?? creds?.mechanismProperties ?? {},
      source: options.source ?? options.db ?? creds?.source ?? 'admin'
    });
  }
}
