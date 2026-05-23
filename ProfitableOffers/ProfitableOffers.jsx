import React from "react";
import './ProfitableOffers.css'
import sales from "../../assets/icons/sales.svg"
export default function ProfitableOffers({numOfGoods, pricePerGood}){
    return(
        <div className="offers">
            <img src={sales} alt="sales icon"/>
            <span className="offer__text">
                <span >от {numOfGoods} штук - </span>
                <span className="offer__price">{pricePerGood} </span> рублей за штуку
            </span>
            
        </div>
    )
}