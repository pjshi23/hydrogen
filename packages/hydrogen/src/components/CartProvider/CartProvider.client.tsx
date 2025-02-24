import React, {
  useEffect,
  useCallback,
  useReducer,
  useMemo,
  useRef,
} from 'react';
import type {Reducer} from 'react';
import {flattenConnection} from '../../utilities';
import {
  CartCreateMutation,
  CartCreateMutationVariables,
} from './graphql/CartCreateMutation';
import {Cart, CartAction, State} from './types';
import {
  CartLineAddMutation,
  CartLineAddMutationVariables,
} from './graphql/CartLineAddMutation';
import {
  CartLineAdd,
  CartCreate,
  CartLineRemove,
  CartLineUpdate,
  CartNoteUpdate,
  CartBuyerIdentityUpdate,
  CartAttributesUpdate,
  CartDiscountCodesUpdate,
  CartQuery,
} from './cart-queries';
import {
  CartLineInput,
  CartInput,
  CartLineUpdateInput,
  CartBuyerIdentityInput,
  AttributeInput,
} from '../../storefront-api-types';
import {useCartFetch} from './hooks.client';
import {CartContext} from './context';
import {
  CartLineRemoveMutationVariables,
  CartLineRemoveMutation,
} from './graphql/CartLineRemoveMutation';
import {
  CartLineUpdateMutationVariables,
  CartLineUpdateMutation,
} from './graphql/CartLineUpdateMutation';
import {
  CartNoteUpdateMutationVariables,
  CartNoteUpdateMutation,
} from './graphql/CartNoteUpdateMutation';
import {
  CartBuyerIdentityUpdateMutationVariables,
  CartBuyerIdentityUpdateMutation,
} from './graphql/CartBuyerIdentityUpdateMutation';
import {
  CartDiscountCodesUpdateMutationVariables,
  CartDiscountCodesUpdateMutation,
} from './graphql/CartDiscountCodesUpdateMutation';

import {
  CartAttributesUpdateMutationVariables,
  CartAttributesUpdateMutation,
} from './graphql/CartAttributesUpdateMutation';
import {CART_ID_STORAGE_KEY} from './constants';
import {CartFragmentFragment} from './graphql/CartFragment';
import {CartQueryQuery, CartQueryQueryVariables} from './graphql/CartQuery';

import {useServerProps} from '../../foundation/useServerProps';
import {ServerPropsContextValue} from '../../foundation';
import type {CartWithActions} from './types';
import {ClientAnalytics} from '../../foundation/Analytics';

function cartReducer(state: State, action: CartAction): State {
  switch (action.type) {
    case 'cartFetch': {
      if (state.status === 'uninitialized') {
        return {
          status: 'fetching',
        };
      }
      break;
    }
    case 'cartCreate': {
      if (state.status === 'uninitialized') {
        return {
          status: 'creating',
        };
      }
      break;
    }
    case 'resolve': {
      const resolvableStatuses = ['updating', 'fetching', 'creating'];
      if (resolvableStatuses.includes(state.status)) {
        return {
          status: 'idle',
          cart: action.cart,
        };
      }
      break;
    }
    case 'reject': {
      if (state.status === 'fetching' || state.status === 'creating') {
        return {status: 'uninitialized', error: action.error};
      } else if (state.status === 'updating') {
        return {
          status: 'idle',
          cart: state.lastValidCart,
          error: action.error,
        };
      }
      break;
    }
    case 'resetCart': {
      if (state.status === 'fetching') {
        return {status: 'uninitialized'};
      }
      break;
    }
    case 'addLineItem': {
      if (state.status === 'idle') {
        return {
          status: 'updating',
          cart: state.cart,
          lastValidCart: state.cart,
        };
      }
      break;
    }
    case 'removeLineItem': {
      if (state.status === 'idle') {
        return {
          status: 'updating',
          cart: {
            ...state.cart,
            lines: state.cart.lines.filter(
              ({id}) => !action.lines.includes(id)
            ),
          },
          lastValidCart: state.cart,
        };
      }
      break;
    }
    case 'updateLineItem': {
      if (state.status === 'idle') {
        return {
          status: 'updating',
          cart: {
            ...state.cart,
            lines: state.cart.lines.map((line) => {
              const updatedLine = action.lines.find(({id}) => id === line.id);

              if (updatedLine && updatedLine.quantity) {
                return {
                  ...line,
                  quantity: updatedLine.quantity,
                };
              }

              return line;
            }),
          },
          lastValidCart: state.cart,
        };
      }
      break;
    }
    case 'noteUpdate': {
      if (state.status === 'idle') {
        return {
          status: 'updating',
          cart: state.cart,
          lastValidCart: state.cart,
        };
      }
      break;
    }
    case 'buyerIdentityUpdate': {
      if (state.status === 'idle') {
        return {
          status: 'updating',
          cart: state.cart,
          lastValidCart: state.cart,
        };
      }
      break;
    }
    case 'cartAttributesUpdate': {
      if (state.status === 'idle') {
        return {
          status: 'updating',
          cart: state.cart,
          lastValidCart: state.cart,
        };
      }
      break;
    }
    case 'discountCodesUpdate': {
      if (state.status === 'idle') {
        return {
          status: 'updating',
          cart: state.cart,
          lastValidCart: state.cart,
        };
      }
      break;
    }
  }
  throw new Error(
    `Cannot dispatch event (${action.type}) for current cart state (${state.status})`
  );
}

/**
 * The `CartProvider` component creates a context for using a cart. It creates a cart object and callbacks
 * that can be accessed by any descendent component using the `useCart` hook and related hooks. It also carries out
 * any callback props when a relevant action is performed. For example, if a `onLineAdd` callback is provided,
 * then the callback will be called when a new line item is successfully added to the cart.
 *
 * The `CartProvider` component must be a descendent of the `ShopifyProvider` component.
 * You must use this component if you want to use the `useCart` hook or related hooks, or if you would like to use the `AddToCartButton` component.
 */
export function CartProvider({
  children,
  numCartLines,
  onCreate,
  onLineAdd,
  onLineRemove,
  onLineUpdate,
  onNoteUpdate,
  onBuyerIdentityUpdate,
  onAttributesUpdate,
  onDiscountCodesUpdate,
  data: cart,
}: {
  /** Any `ReactNode` elements. */
  children: React.ReactNode;
  numCartLines?: number;
  /** A callback that is invoked when the process to create a cart begins, but before the cart is created in the Storefront API. */
  onCreate?: () => void;
  /** A callback that is invoked when the process to add a line item to the cart begins, but before the line item is added to the Storefront API. */
  onLineAdd?: () => void;
  /** A callback that is invoked when the process to remove a line item to the cart begins, but before the line item is removed from the Storefront API. */
  onLineRemove?: () => void;
  /** A callback that is invoked when the process to update a line item in the cart begins, but before the line item is updated in the Storefront API. */
  onLineUpdate?: () => void;
  /** A callback that is invoked when the process to add or update a note in the cart begins, but before the note is added or updated in the Storefront API. */
  onNoteUpdate?: () => void;
  /** A callback that is invoked when the process to update the buyer identity begins, but before the buyer identity is updated in the Storefront API. */
  onBuyerIdentityUpdate?: () => void;
  /** A callback that is invoked when the process to update the cart attributes begins, but before the attributes are updated in the Storefront API. */
  onAttributesUpdate?: () => void;
  /** A callback that is invoked when the process to update the cart discount codes begins, but before the discount codes are updated in the Storefront API. */
  onDiscountCodesUpdate?: () => void;
  /**
   * An object with fields that correspond to the Storefront API's [Cart object](https://shopify.dev/api/storefront/latest/objects/cart).
   */
  data?: CartFragmentFragment;
}) {
  const {serverProps} = useServerProps() as ServerPropsContextValue;
  const countryCode = serverProps?.country?.isoCode;

  const initialStatus: State = cart
    ? {status: 'idle', cart: cartFromGraphQL(cart)}
    : {status: 'uninitialized'};
  const [state, dispatch] = useReducer<Reducer<State, CartAction>>(
    (state, dispatch) => cartReducer(state, dispatch),
    initialStatus
  );
  const fetchCart = useCartFetch();

  const cartFetch = useCallback(
    async (cartId: string) => {
      dispatch({type: 'cartFetch'});

      const {data} = await fetchCart<CartQueryQueryVariables, CartQueryQuery>({
        query: CartQuery,
        variables: {
          id: cartId,
          numCartLines,
          country: countryCode,
        },
      });

      if (!data?.cart) {
        window.localStorage.removeItem(CART_ID_STORAGE_KEY);
        dispatch({type: 'resetCart'});
        return;
      }

      dispatch({type: 'resolve', cart: cartFromGraphQL(data.cart)});
    },
    [fetchCart, numCartLines, countryCode]
  );

  const cartCreate = useCallback(
    async (cart: CartInput) => {
      dispatch({type: 'cartCreate'});

      onCreate?.();

      if (countryCode && !cart.buyerIdentity?.countryCode) {
        if (cart.buyerIdentity == null) {
          cart.buyerIdentity = {};
        }
        cart.buyerIdentity.countryCode = countryCode;
      }

      const {data, error} = await fetchCart<
        CartCreateMutationVariables,
        CartCreateMutation
      >({
        query: CartCreate,
        variables: {
          input: cart,
          numCartLines,
          country: countryCode,
        },
      });

      if (error) {
        dispatch({
          type: 'reject',
          error,
        });
      }

      if (data?.cartCreate?.cart) {
        if (cart.lines) {
          ClientAnalytics.publish(
            ClientAnalytics.eventNames.ADD_TO_CART,
            true,
            {
              addedCartLines: cart.lines,
              cart: data.cartCreate.cart,
            }
          );
        }
        dispatch({
          type: 'resolve',
          cart: cartFromGraphQL(data.cartCreate.cart),
        });

        window.localStorage.setItem(
          CART_ID_STORAGE_KEY,
          data.cartCreate.cart.id
        );
      }
    },
    [onCreate, fetchCart, numCartLines, countryCode]
  );

  const addLineItem = useCallback(
    async (lines: CartLineInput[], state: State) => {
      if (state.status === 'idle') {
        dispatch({type: 'addLineItem'});
        onLineAdd?.();
        const {data, error} = await fetchCart<
          CartLineAddMutationVariables,
          CartLineAddMutation
        >({
          query: CartLineAdd,
          variables: {
            cartId: state.cart.id!,
            lines,
            numCartLines,
            country: countryCode,
          },
        });

        if (error) {
          dispatch({
            type: 'reject',
            error,
          });
        }

        if (data?.cartLinesAdd?.cart) {
          ClientAnalytics.publish(
            ClientAnalytics.eventNames.ADD_TO_CART,
            true,
            {
              addedCartLines: lines,
              cart: data.cartLinesAdd.cart,
            }
          );
          dispatch({
            type: 'resolve',
            cart: cartFromGraphQL(data.cartLinesAdd.cart),
          });
        }
      }
    },
    [fetchCart, numCartLines, onLineAdd, countryCode]
  );

  const removeLineItem = useCallback(
    async (lines: string[], state: State) => {
      if (state.status === 'idle') {
        dispatch({type: 'removeLineItem', lines});

        onLineRemove?.();

        const {data, error} = await fetchCart<
          CartLineRemoveMutationVariables,
          CartLineRemoveMutation
        >({
          query: CartLineRemove,
          variables: {
            cartId: state.cart.id!,
            lines,
            numCartLines,
            country: countryCode,
          },
        });

        if (error) {
          dispatch({
            type: 'reject',
            error,
          });
        }

        if (data?.cartLinesRemove?.cart) {
          ClientAnalytics.publish(
            ClientAnalytics.eventNames.REMOVE_FROM_CART,
            true,
            {
              removedCartLines: lines,
              cart: data.cartLinesRemove.cart,
            }
          );
          dispatch({
            type: 'resolve',
            cart: cartFromGraphQL(data.cartLinesRemove.cart),
          });
        }
      }
    },
    [fetchCart, onLineRemove, numCartLines, countryCode]
  );

  const updateLineItem = useCallback(
    async (lines: CartLineUpdateInput[], state: State) => {
      if (state.status === 'idle') {
        dispatch({type: 'updateLineItem', lines});

        onLineUpdate?.();

        const {data, error} = await fetchCart<
          CartLineUpdateMutationVariables,
          CartLineUpdateMutation
        >({
          query: CartLineUpdate,
          variables: {
            cartId: state.cart.id!,
            lines,
            numCartLines,
            country: countryCode,
          },
        });
        if (error) {
          dispatch({
            type: 'reject',
            error,
          });
        }

        if (data?.cartLinesUpdate?.cart) {
          ClientAnalytics.publish(
            ClientAnalytics.eventNames.UPDATE_CART,
            true,
            {
              updatedCartLines: lines,
              oldCart: state.cart,
            }
          );
          dispatch({
            type: 'resolve',
            cart: cartFromGraphQL(data.cartLinesUpdate.cart),
          });
        }
      }
    },
    [fetchCart, onLineUpdate, numCartLines, countryCode]
  );

  const noteUpdate = useCallback(
    async (note: CartNoteUpdateMutationVariables['note'], state: State) => {
      if (state.status === 'idle') {
        dispatch({type: 'noteUpdate'});

        onNoteUpdate?.();

        const {data, error} = await fetchCart<
          CartNoteUpdateMutationVariables,
          CartNoteUpdateMutation
        >({
          query: CartNoteUpdate,
          variables: {
            cartId: state.cart.id!,
            note,
            numCartLines,
            country: countryCode,
          },
        });

        if (error) {
          dispatch({
            type: 'reject',
            error,
          });
        }

        if (data?.cartNoteUpdate?.cart) {
          dispatch({
            type: 'resolve',
            cart: cartFromGraphQL(data.cartNoteUpdate.cart),
          });
        }
      }
    },
    [fetchCart, onNoteUpdate, numCartLines, countryCode]
  );

  const buyerIdentityUpdate = useCallback(
    async (buyerIdentity: CartBuyerIdentityInput, state: State) => {
      if (state.status === 'idle') {
        dispatch({type: 'buyerIdentityUpdate'});

        onBuyerIdentityUpdate?.();

        const {data, error} = await fetchCart<
          CartBuyerIdentityUpdateMutationVariables,
          CartBuyerIdentityUpdateMutation
        >({
          query: CartBuyerIdentityUpdate,
          variables: {
            cartId: state.cart.id!,
            buyerIdentity,
            numCartLines,
            country: countryCode,
          },
        });

        if (error) {
          dispatch({
            type: 'reject',
            error,
          });
        }

        if (data?.cartBuyerIdentityUpdate?.cart) {
          dispatch({
            type: 'resolve',
            cart: cartFromGraphQL(data.cartBuyerIdentityUpdate.cart),
          });
        }
      }
    },
    [fetchCart, onBuyerIdentityUpdate, numCartLines, countryCode]
  );

  const cartAttributesUpdate = useCallback(
    async (attributes: AttributeInput[], state: State) => {
      if (state.status === 'idle') {
        dispatch({type: 'cartAttributesUpdate'});

        onAttributesUpdate?.();

        const {data, error} = await fetchCart<
          CartAttributesUpdateMutationVariables,
          CartAttributesUpdateMutation
        >({
          query: CartAttributesUpdate,
          variables: {
            cartId: state.cart.id!,
            attributes,
            numCartLines,
            country: countryCode,
          },
        });

        if (error) {
          dispatch({
            type: 'reject',
            error,
          });
        }

        if (data?.cartAttributesUpdate?.cart) {
          dispatch({
            type: 'resolve',
            cart: cartFromGraphQL(data.cartAttributesUpdate.cart),
          });
        }
      }
    },
    [fetchCart, onAttributesUpdate, numCartLines, countryCode]
  );

  const discountCodesUpdate = useCallback(
    async (
      discountCodes: CartDiscountCodesUpdateMutationVariables['discountCodes'],
      state: State
    ) => {
      if (state.status === 'idle') {
        dispatch({type: 'discountCodesUpdate'});

        onDiscountCodesUpdate?.();

        const {data, error} = await fetchCart<
          CartDiscountCodesUpdateMutationVariables,
          CartDiscountCodesUpdateMutation
        >({
          query: CartDiscountCodesUpdate,
          variables: {
            cartId: state.cart.id!,
            discountCodes,
            numCartLines,
            country: countryCode,
          },
        });

        if (error) {
          dispatch({
            type: 'reject',
            error,
          });
        }

        if (data?.cartDiscountCodesUpdate?.cart) {
          ClientAnalytics.publish(
            ClientAnalytics.eventNames.DISCOUNT_CODE_UPDATED,
            true,
            {
              updatedDiscountCodes: discountCodes,
              cart: data.cartDiscountCodesUpdate.cart,
            }
          );
          dispatch({
            type: 'resolve',
            cart: cartFromGraphQL(data.cartDiscountCodesUpdate.cart),
          });
        }
      }
    },
    [fetchCart, onDiscountCodesUpdate, numCartLines, countryCode]
  );

  const didFetchCart = useRef(false);

  useEffect(() => {
    if (
      localStorage.getItem(CART_ID_STORAGE_KEY) &&
      state.status === 'uninitialized' &&
      !didFetchCart.current
    ) {
      didFetchCart.current = true;
      cartFetch(localStorage.getItem(CART_ID_STORAGE_KEY)!);
    }
  }, [cartFetch, state]);

  useEffect(() => {
    if (state.status !== 'idle') {
      return;
    }
    buyerIdentityUpdate({countryCode}, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryCode]);

  const cartContextValue = useMemo<CartWithActions>(() => {
    return {
      ...('cart' in state
        ? state.cart
        : {
            lines: [],
            attributes: [],
            ...(cart ? cartFromGraphQL(cart) : {}),
          }),
      status: state.status,
      error: 'error' in state ? state.error : undefined,
      totalQuantity:
        'cart' in state
          ? state.cart.lines.reduce((previous, current) => {
              return previous + current.quantity;
            }, 0)
          : 0,
      cartCreate,
      linesAdd(lines: CartLineInput[]) {
        if ('cart' in state && state.cart.id) {
          addLineItem(lines, state);
        } else {
          cartCreate({lines});
        }
      },
      linesRemove(lines: string[]) {
        removeLineItem(lines, state);
      },
      linesUpdate(lines: CartLineUpdateInput[]) {
        updateLineItem(lines, state);
      },
      noteUpdate(note: CartNoteUpdateMutationVariables['note']) {
        noteUpdate(note, state);
      },
      buyerIdentityUpdate(buyerIdentity: CartBuyerIdentityInput) {
        buyerIdentityUpdate(buyerIdentity, state);
      },
      cartAttributesUpdate(attributes: AttributeInput[]) {
        cartAttributesUpdate(attributes, state);
      },
      discountCodesUpdate(
        discountCodes: CartDiscountCodesUpdateMutationVariables['discountCodes']
      ) {
        discountCodesUpdate(discountCodes, state);
      },
    };
  }, [
    state,
    cart,
    cartCreate,
    addLineItem,
    removeLineItem,
    updateLineItem,
    noteUpdate,
    buyerIdentityUpdate,
    cartAttributesUpdate,
    discountCodesUpdate,
  ]);

  return (
    <CartContext.Provider value={cartContextValue}>
      {children}
    </CartContext.Provider>
  );
}

function cartFromGraphQL(cart: CartFragmentFragment): Cart {
  return {
    ...cart,
    // @ts-expect-error While the cart still uses fragments, there will be a TS error here until we remove those fragments and get the type in-line
    lines: flattenConnection(cart.lines),
    note: cart.note ?? undefined,
  };
}
