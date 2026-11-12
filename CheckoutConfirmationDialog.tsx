import React from 'react';
import { PurchaseConfirmationModal } from '../PurchaseConfirmationModal';
import type {
  CouponItem,
  PayPalConnectionStatus,
  PurchaseRecord,
  RankedProductOffer,
  UserCartSummary,
} from '../../types/spark';

export interface CheckoutConfirmationDialogProps {
  product?: RankedProductOffer | null;
  fromCart?: boolean;
  cart?: UserCartSummary | null;
  availableCoupons: CouponItem[];
  paypalStatus: PayPalConnectionStatus;
  paypalEmail?: string;
  onConnectPayPal: () => Promise<void>;
  onOpenPayPalSandbox?: () => void;
  onViewMyPurchases?: () => void;
  onUpdateCartQuantity?: (itemId: string, quantity: number) => Promise<void> | void;
  onRemoveCartItem?: (itemId: string) => Promise<void> | void;
  onCartUpdated?: (cart: UserCartSummary) => void;
  onClose: () => void;
  onPurchaseSuccess: (record: PurchaseRecord, updatedCart?: UserCartSummary) => void;
}

export const CheckoutConfirmationDialog: React.FC<CheckoutConfirmationDialogProps> = (props) => {
  return <PurchaseConfirmationModal {...props} />;
};


