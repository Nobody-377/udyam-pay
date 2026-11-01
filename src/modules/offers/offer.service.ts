import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors';
import { assertTransition } from '../applications/application-state-machine';
import type {
  ActorType,
  AppStores,
  FinancingOfferEntity,
} from '../persistence/stores';

export interface AcceptOfferParams {
  applicationId: string;
  offerId: string;
  customerId?: string;
  actorType: ActorType;
  actorId?: string;
}

export class OfferService {
  constructor(private readonly stores: AppStores) {}

  async listOffers(
    applicationId: string,
    merchantId?: string,
  ): Promise<FinancingOfferEntity[]> {
    const app = await this.stores.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application not found');
    if (merchantId && app.merchantId !== merchantId) {
      throw new ForbiddenError('Access denied: merchant mismatch');
    }

    return this.stores.offers.listByApplication(applicationId, 'ACTIVE');
  }

  async getOffer(offerId: string): Promise<FinancingOfferEntity> {
    const offer = await this.stores.offers.findById(offerId);
    if (!offer) throw new NotFoundError('Offer not found');
    return offer;
  }

  async acceptOffer(params: AcceptOfferParams): Promise<{ offer: FinancingOfferEntity; applicationStatus: string }> {
    const { applicationId, offerId, customerId, actorType, actorId } = params;

    const app = await this.stores.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application not found');

    if (customerId && app.customerId !== customerId) {
      throw new ForbiddenError('Offer does not belong to this customer');
    }

    const offer = await this.stores.offers.findById(offerId);
    if (!offer) throw new NotFoundError('Offer not found');

    if (offer.applicationId !== applicationId) {
      throw new ConflictError('Offer does not belong to this financing application');
    }

    if (offer.status !== 'ACTIVE') {
      throw new ConflictError(`Offer is not active (status: ${offer.status})`);
    }

    if (offer.expiresAt && offer.expiresAt < new Date()) {
      await this.stores.offers.updateStatus(offer.id, 'EXPIRED');
      throw new ConflictError('Offer has expired');
    }

    // Enforce state machine: OFFER_AVAILABLE -> CUSTOMER_ACCEPTED_OFFER
    assertTransition(app.status, 'CUSTOMER_ACCEPTED_OFFER', {
      actor: actorType,
    });

    // Mark accepted offer
    await this.stores.offers.updateStatus(offer.id, 'ACCEPTED');

    // Supersede all other active offers for this application
    await this.stores.offers.supersedeOthers(applicationId, offer.id);

    // Transition application to CUSTOMER_ACCEPTED_OFFER
    const updatedApp = await this.stores.applications.updateStatus({
      id: app.id,
      expectedVersion: app.version,
      toStatus: 'CUSTOMER_ACCEPTED_OFFER',
      actorType,
      actorId,
      reason: `Customer accepted offer ${offer.lenderOfferReference} (${offer.tenureMonths}M EMI)`,
      metadata: {
        offerId: offer.id,
        tenureMonths: offer.tenureMonths,
        emiPaise: offer.emiPaise.toString(),
      },
    });

    return {
      offer: { ...offer, status: 'ACCEPTED' },
      applicationStatus: updatedApp.status,
    };
  }
}

