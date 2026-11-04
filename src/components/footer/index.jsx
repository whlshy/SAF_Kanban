import React from 'react'
import { Link } from 'react-router-dom'

function index(props) {
  const { title } = props
  return (
    <footer>
      {/* <div className='footer-content flex aic'>
        <Link to="/" className='reset-link flex aic jcc'>
          {title}
        </Link>
      </div> */}
      <div className='footer-content footer-info flex aic'>
        <div className='flex rowTitle'>
          <a
            href="https://github.com/whlshy/SAF_Kanban"
            target="_blank"
            rel="noopener noreferrer"
            className='reset-link underline-offset-2 hover:underline'
          >
            SAF Kanban
          </a>
          . WHL. All rights reserved.
        </div>
      </div>
    </footer>

  )
}

export default index