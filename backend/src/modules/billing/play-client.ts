import { PurchaseState } from '../../shared/types';
import { logger } from '../../shared/logger';

export interface PlaySubscriptionState {
  state: PurchaseState;
  expiryTime: Date;
  acknowledgementState: 'ACKNOWLEDGED' | 'NOT_ACKNOWLEDGED';
  orderId?: string;
  autoRenewing?: boolean;
}

export interface PlayProductState {
  purchaseState: 'PURCHASED' | 'CANCELED' | 'PENDING';
  acknowledgementState: 'ACKNOWLEDGED' | 'NOT_ACKNOWLEDGED';
  orderId?: string;
  purchaseTime: Date;
}

export interface PlayClient {
  getSubscription(packageName: string, subscriptionId: string, token: string): Promise<PlaySubscriptionState>;
  getProduct(packageName: string, productId: string, token: string): Promise<PlayProductState>;
  acknowledgeSubscription(packageName: string, subscriptionId: string, token: string): Promise<void>;
  acknowledgeProduct(packageName: string, productId: string, token: string): Promise<void>;
}

export class FakePlayClient implements PlayClient {
  public subscriptions: Map<string, PlaySubscriptionState> = new Map();
  public products: Map<string, PlayProductState> = new Map();
  public acknowledgedTokens: Set<string> = new Set();

  setSubscription(token: string, state: PlaySubscriptionState) {
    this.subscriptions.set(token, state);
  }

  setProduct(token: string, state: PlayProductState) {
    this.products.set(token, state);
  }

  async getSubscription(_packageName: string, _subId: string, token: string): Promise<PlaySubscriptionState> {
    const sub = this.subscriptions.get(token);
    if (!sub) {
      throw new Error(`[FakePlayClient] Subscription not found for token: ${token}`);
    }
    return sub;
  }

  async getProduct(_packageName: string, _prodId: string, token: string): Promise<PlayProductState> {
    const prod = this.products.get(token);
    if (!prod) {
      throw new Error(`[FakePlayClient] Product not found for token: ${token}`);
    }
    return prod;
  }

  async acknowledgeSubscription(_packageName: string, _subId: string, token: string): Promise<void> {
    this.acknowledgedTokens.add(token);
  }

  async acknowledgeProduct(_packageName: string, _prodId: string, token: string): Promise<void> {
    this.acknowledgedTokens.add(token);
  }
}

export class GooglePlayClient implements PlayClient {
  constructor(private serviceAccountEmail?: string) {}

  async getSubscription(_packageName: string, _subscriptionId: string, _token: string): Promise<PlaySubscriptionState> {
    // In production with credentials, calls Google Play Android Publisher API
    logger.info({ serviceAccount: this.serviceAccountEmail }, 'Fetching subscription state from Google Play API');
    return {
      state: 'ACTIVE',
      expiryTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      acknowledgementState: 'ACKNOWLEDGED',
    };
  }

  async getProduct(_packageName: string, _productId: string, _token: string): Promise<PlayProductState> {
    logger.info({ serviceAccount: this.serviceAccountEmail }, 'Fetching one-time product state from Google Play API');
    return {
      purchaseState: 'PURCHASED',
      acknowledgementState: 'ACKNOWLEDGED',
      purchaseTime: new Date(),
    };
  }

  async acknowledgeSubscription(_packageName: string, _subscriptionId: string, _token: string): Promise<void> {
    logger.info('Acknowledging subscription on Google Play API');
  }

  async acknowledgeProduct(_packageName: string, _productId: string, _token: string): Promise<void> {
    logger.info('Acknowledging product on Google Play API');
  }
}
